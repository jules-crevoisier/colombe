/**
 * Intégration réelle de la connexion unique via une passerelle SAML : un IdP SAML
 * autonome (kristophjunge/test-saml-idp, SimpleSAMLphp 1.15) fédéré dans Keycloak 26
 * (Identity Provider = SAML), Keycloak restant l'unique fournisseur OpenID Connect vu par
 * Colombe et par Dovecot 2.4 (introspection) — voir docker-compose.saml.yml et
 * tests/integration/saml/. Reproduit l'architecture recommandée pour la fédération
 * RENATER pure (IdP SAML sans greffon OIDC) : docs/admin/connexion-unique.md,
 * §Fédération RENATER / SAML seul.
 *
 * Colombe ne voit jamais le SAML : il ne parle qu'OIDC à Keycloak, exactement comme dans
 * le banc Keycloak direct (tests/integration/sso.dovecot.test.ts). Le SAML n'apparaît que
 * dans la façon dont on simule le navigateur ici : Keycloak affiche un bouton « saml-idp »
 * sur sa page de connexion (pas de formulaire natif dans ce banc, aucun utilisateur local
 * n'a de mot de passe côté Keycloak), on le suit, on remplit le formulaire SimpleSAMLphp,
 * on repasse l'assertion signée à l'ACS de Keycloak.
 *
 * Deux niveaux, comme le banc Keycloak direct :
 *   1. bibliothèques de Colombe (IMAP, ManageSieve, SMTP) avec un jeton Keycloak réel
 *      obtenu après une fédération SAML complète, en XOAUTH2 et OAUTHBEARER ;
 *   2. serveur Colombe construit (.output) : connexion par le vrai bouton de Keycloak, la
 *      vraie page SimpleSAMLphp, la vraie assertion SAML signée, jusqu'à la boîte.
 *
 * Lancer : docker compose -f docker-compose.saml.yml up -d --wait, puis `pnpm test:saml`.
 * Ignoré automatiquement si Keycloak (localhost:8280), le banc SAML (localhost:8081) ou
 * Dovecot (127.0.0.1:3147) n'écoutent pas.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FiltersStatus, Folder } from '#shared/types/mail'
import type { MailCredentials, MailServerConfig } from '../../server/lib/mail/backend'
import { ImapBackend, verifyImapCredentials } from '../../server/lib/mail/imap'
import { SieveClient } from '../../server/lib/sieve/client'
import type { SieveConfig } from '../../server/lib/sieve/client'

const KEYCLOAK = 'http://localhost:8280'
const ISSUER = `${KEYCLOAK}/realms/colombe`
const SAML_IDP = 'http://localhost:8081'
const CLIENT_ID = 'colombe'
const CLIENT_SECRET = 'colombe-saml-test-secret'
const MAILPIT = 'http://127.0.0.1:18027'
/** Comptes SimpleSAMLphp par défaut de kristophjunge/test-saml-idp (non modifiables sans recompiler l'image). */
const USER1 = { user: 'user1', password: 'user1pass', email: 'user1@example.com' }
const USER2 = { user: 'user2', password: 'user2pass', email: 'user2@example.com' }
/** Port fixe : seule URI de redirection déclarée dans le royaume Keycloak de ce banc. */
const COLOMBE_PORT = 39323
const REDIRECT_URI = `http://localhost:${COLOMBE_PORT}/api/auth/oidc/callback`

function listening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host)
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

const reachable = (await listening(8280)) && (await listening(8081)) && (await listening(3147)) && (await listening(4193))

const oauth2Server = (mechanism: 'xoauth2' | 'oauthbearer'): MailServerConfig => ({
  imapHost: '127.0.0.1',
  imapPort: 3147,
  imapSecure: false,
  imapServername: 'localhost',
  smtpHost: '127.0.0.1',
  smtpPort: 3589,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpServername: 'localhost',
  tlsRejectUnauthorized: false, // certificat auto-signé de l'image Dovecot
  loginUsername: 'email',
  mailSso: { mode: 'oauth2', mechanism },
})
const sieveConfig: SieveConfig = { host: '127.0.0.1', port: 4193, rejectUnauthorized: false, servername: 'localhost' }

// ─── Le « navigateur » : cookies séparés pour Keycloak et pour le SAML IdP (deux origines). ───

class Jar {
  private cookies = new Map<string, string>()
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? ''
      const eq = pair.indexOf('=')
      if (eq < 1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!value || /max-age=0/i.test(line) || /expires=Thu, 01[- ]Jan[- ]1970/i.test(line)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
}

interface FormScrape { action: string; inputs: Record<string, string> }

/** Un seul `<form>` HTML avec ses champs cachés : les pages de rebond SAML (auto-submit) et le formulaire SimpleSAMLphp. */
function scrapeForm(html: string, byName?: string): FormScrape {
  const named = byName ? new RegExp(`<form[^>]*name="${byName}"[^>]*action="([^"]+)"`).exec(html) : null
  const action = (named ?? /<form[^>]*action="([^"]+)"/.exec(html))?.[1]
  if (!action) throw new Error(`Formulaire introuvable (byName=${byName ?? '-'})`)
  const inputs: Record<string, string> = {}
  const re = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(html))) inputs[m[1]!] = m[2]!.replace(/&amp;/g, '&')
  return { action: action.replace(/&amp;/g, '&'), inputs }
}

/**
 * Fédération SAML complète pour `account`, jusqu'au code d'autorisation OIDC renvoyé par
 * Keycloak à `redirectUri` : suit le vrai bouton « saml-idp » sur la page Keycloak (aucun
 * indice `kc_idp_hint`, exactement ce qu'un utilisateur ferait), le vrai formulaire
 * SimpleSAMLphp, la vraie assertion SAML signée repassée à l'ACS de Keycloak. Gère aussi,
 * silencieusement, l'écran « Update Account Information » d'un tout premier login fédéré
 * (compte Keycloak pas encore lié) : les logins suivants du même compte ne le déclenchent
 * plus (l'identité fédérée est liée par l'attribut `email`, voir la configuration
 * `principalType: ATTRIBUTE` du royaume — pas par le NameID, transitoire côté
 * SimpleSAMLphp, qui changerait à chaque session).
 */
async function samlCallbackUrl(
  kc: Jar,
  account: { user: string; password: string; email: string },
  authorizeUrl: string
): Promise<string> {
  let res = await fetch(authorizeUrl, { redirect: 'manual', headers: { cookie: kc.header() } })
  kc.store(res)
  expect(res.status, 'GET autorisation Keycloak').toBe(200)
  let html = await res.text()
  const brokerHref = /href="([^"]*\/broker\/saml-idp\/login[^"]*)"/.exec(html)?.[1]?.replace(/&amp;/g, '&')
  expect(brokerHref, 'lien « saml-idp » introuvable sur la page de connexion Keycloak').toBeTruthy()
  const brokerUrl = new URL(brokerHref!, KEYCLOAK)

  res = await fetch(brokerUrl, { redirect: 'manual', headers: { cookie: kc.header() } })
  kc.store(res)
  expect(res.status, 'broker/saml-idp/login').toBe(200)
  html = await res.text()
  const authnRequestForm = scrapeForm(html, 'saml-post-binding')

  const idp = new Jar()
  res = await fetch(authnRequestForm.action, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: idp.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(authnRequestForm.inputs),
  })
  idp.store(res)
  expect(res.status, 'SAMLRequest -> SSOService.php').toBe(303)
  html = await res.text()
  const loginUrl = /URL='([^']+)'/.exec(html)?.[1]
  expect(loginUrl, 'redirection SimpleSAMLphp vers le formulaire de connexion').toBeTruthy()

  res = await fetch(loginUrl!, { headers: { cookie: idp.header() } })
  idp.store(res)
  expect(res.status, 'formulaire de connexion SimpleSAMLphp').toBe(200)
  html = await res.text()
  const authState = /<input[^>]*name="AuthState"[^>]*value="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&')
  expect(authState, 'AuthState du formulaire SimpleSAMLphp').toBeTruthy()

  res = await fetch(loginUrl!, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: idp.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: account.user, password: account.password, AuthState: authState! }),
  })
  idp.store(res)
  expect(res.status, 'identifiants SimpleSAMLphp').toBe(200)
  html = await res.text()
  const assertionForm = scrapeForm(html)
  expect(assertionForm.inputs.SAMLResponse, 'assertion SAML signée').toBeTruthy()

  res = await fetch(assertionForm.action, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: kc.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(assertionForm.inputs),
  })
  kc.store(res)
  expect(res.status, 'SAMLResponse -> ACS Keycloak').toBe(302)
  let location = res.headers.get('location')!

  if (location.includes('/login-actions/first-broker-login')) {
    res = await fetch(location, { redirect: 'manual', headers: { cookie: kc.header() } })
    kc.store(res)
    html = await res.text()
    if (html.includes('kc-idp-review-profile-form')) {
      const reviewForm = scrapeForm(html)
      const usernameValue = /name="username"[^>]*value="([^"]*)"/.exec(html)?.[1] ?? ''
      // Keycloak exige un identifiant d'au moins 3 caractères ; l'uid SAML (« 1 », « 2 »…) est trop court seul.
      const username = usernameValue.length >= 3 ? usernameValue : `saml-${usernameValue}`
      res = await fetch(reviewForm.action, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: kc.header(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, email: account.email, firstName: account.user, lastName: 'SAML' }),
      })
      kc.store(res)
      expect(res.status, 'formulaire « Update Account Information »').toBe(302)
    }
    location = res.headers.get('location')!
  }

  // location pointe maintenant vers /broker/after-first-broker-login (premier login) ou
  // directement vers redirect_uri (login suivant, déjà lié) : dans les deux cas, un dernier
  // saut de Keycloak mène au redirect_uri avec le code d'autorisation.
  if (!location.startsWith(REDIRECT_URI)) {
    res = await fetch(location, { redirect: 'manual', headers: { cookie: kc.header() } })
    kc.store(res)
    location = res.headers.get('location')!
  }
  expect(location.startsWith(REDIRECT_URI), `redirection finale vers Colombe (reçu ${location})`).toBe(true)
  expect(new URL(location).searchParams.get('code'), 'code d\'autorisation').toBeTruthy()
  return location
}

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number }

/** Jeton Keycloak réel, obtenu après une fédération SAML complète (flux code + PKCE). */
async function samlKeycloakToken(account: { user: string; password: string; email: string }): Promise<TokenResponse> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(8).toString('hex')
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce: randomBytes(8).toString('hex'),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const location = await samlCallbackUrl(new Jar(), account, `${ISSUER}/protocol/openid-connect/auth?${params}`)
  const code = new URL(location).searchParams.get('code')!
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: verifier,
    }),
  })
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as TokenResponse
}

function oauth2Creds(email: string, token: TokenResponse): MailCredentials {
  return { email, auth: { kind: 'oauth2', accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 } }
}

async function mailpitSubjects(): Promise<string[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`)
  const body = (await res.json()) as { messages: { Subject: string }[] }
  return body.messages.map(m => m.Subject)
}

async function waitForMailpit(subject: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if ((await mailpitSubjects()).includes(subject)) return
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`« ${subject} » n'est jamais arrivé dans Mailpit`)
}

const unique = (label: string) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const rawMessage = (from: string, to: string, subject: string) =>
  Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Date.now()}@colombe.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEnvoyé après une fédération SAML.\r\n`)

describe.skipIf(!reachable)('SSO réel : passerelle SAML (SimpleSAMLphp) -> Keycloak 26 -> Dovecot 2.4 — bibliothèques', () => {
  it('IMAP : un jeton Keycloak obtenu après fédération SAML ouvre la boîte (XOAUTH2 et OAUTHBEARER)', async () => {
    const token = await samlKeycloakToken(USER1)
    const creds = oauth2Creds(USER1.email, token)
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      expect(await verifyImapCredentials(creds, oauth2Server(mechanism))).toBe(true)
    }
    const backend = new ImapBackend(creds, oauth2Server('xoauth2'))
    try {
      const folders = await backend.listFolders()
      expect(folders.some(f => f.path === 'INBOX')).toBe(true)
    }
    finally {
      await backend.close()
    }
  })

  it('IMAP : refuse un jeton invalide, et le jeton d\'un autre utilisateur SAML', async () => {
    expect(await verifyImapCredentials(oauth2Creds(USER1.email, { access_token: 'jeton-invalide', refresh_token: '', expires_in: 60 }), oauth2Server('xoauth2'))).toBe(false)
    const user2Token = await samlKeycloakToken(USER2)
    expect(await verifyImapCredentials(oauth2Creds(USER1.email, user2Token), oauth2Server('xoauth2'))).toBe(false)
  })

  it('ManageSieve : AUTHENTICATE XOAUTH2 puis OAUTHBEARER avec le jeton', async () => {
    const token = await samlKeycloakToken(USER1)
    for (const kind of ['xoauth2', 'oauthbearer'] as const) {
      const client = await SieveClient.connect(sieveConfig, { kind, user: USER1.email, accessToken: token.access_token })
      try {
        expect(Array.isArray(await client.listScripts())).toBe(true)
        expect(client.sieveExtensions()).toContain('fileinto')
      }
      finally {
        await client.logout()
      }
    }
  })

  it('SMTP (soumission Dovecot) : AUTH XOAUTH2 puis AUTH OAUTHBEARER, message relayé', async () => {
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      const token = await samlKeycloakToken(USER1)
      const backend = new ImapBackend(oauth2Creds(USER1.email, token), oauth2Server(mechanism))
      const subject = unique(`SSO SAML ${mechanism}`)
      try {
        await backend.send(rawMessage(USER1.email, USER2.email, subject), { from: USER1.email, to: [USER2.email] })
      }
      finally {
        await backend.close()
      }
      await waitForMailpit(subject)
    }
  })
})

// ─── Serveur Colombe construit, connexion par le vrai bouton « saml-idp » de Keycloak ───

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

describe.skipIf(!reachable)('SSO réel : passerelle SAML -> Keycloak -> Dovecot — serveur Colombe', () => {
  let server: ChildProcess | null = null
  let dataDir = ''
  let logs = ''
  const base = `http://localhost:${COLOMBE_PORT}`

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:saml` (nuxt build puis ce fichier).')
    dataDir = mkdtempSync(join(tmpdir(), 'webmail-saml-it-'))
    server = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(COLOMBE_PORT),
        HOST: 'localhost',
        NODE_ENV: 'production',
        MAIL_BACKEND: 'imap',
        MAIL_HOST: '127.0.0.1',
        MAIL_IMAP_PORT: '3147',
        MAIL_IMAP_SECURE: 'false',
        MAIL_SMTP_PORT: '3589',
        MAIL_SMTP_SECURE: 'false',
        MAIL_SIEVE_PORT: '4193',
        MAIL_TLS_SERVERNAME: 'localhost',
        MAIL_TLS_REJECT_UNAUTHORIZED: 'false',
        WEBMAIL_ALLOW_INSECURE_TLS: '1', // certificat auto-signé du conteneur de test
        MAIL_DOMAINS: 'example.com', // domaine des comptes SimpleSAMLphp par défaut
        AUTH_METHODS: 'oidc',
        OIDC_ISSUER: ISSUER,
        OIDC_CLIENT_ID: CLIENT_ID,
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        MAIL_SSO_AUTH: 'oauth2',
        MAIL_OAUTH_MECHANISM: 'xoauth2',
        NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-characters-long',
        WEBMAIL_DATA_KEY: 'test-data-key-at-least-32-characters-long-xx',
        WEBMAIL_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (d: Buffer) => { logs += d.toString() })
    server.stderr?.on('data', (d: Buffer) => { logs += d.toString() })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Le serveur s'est arrêté :\n${logs}`)
      try {
        if ((await fetch(`${base}/api/config`)).ok) return
      }
      catch {
        // pas encore prêt
      }
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`Serveur non prêt après 30 s :\n${logs}`)
  }, 60_000)

  afterAll(async () => {
    const proc = server
    server = null
    if (proc && proc.exitCode === null) {
      const exited = new Promise(resolve => proc.once('exit', resolve))
      proc.kill()
      await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('connexion par le bouton « saml-idp » de Keycloak : formulaire SimpleSAMLphp, boîte IMAP et envoi SMTP', async () => {
    // Démarre exactement comme le vrai bouton de connexion unique de Colombe.
    const kc = new Jar()
    const app = new Jar()
    let res = await fetch(`${base}/api/auth/oidc/start`, { redirect: 'manual', headers: { cookie: app.header() } })
    app.store(res)
    expect(res.status, logs).toBe(302)
    const authorizeUrl = res.headers.get('location')!
    expect(new URL(authorizeUrl).origin).toBe(KEYCLOAK)

    const callbackUrl = await samlCallbackUrl(kc, USER1, authorizeUrl)

    // Colombe échange le code lui-même : on rejoue juste sa redirection de retour (state,
    // session_state, iss compris — samlCallbackUrl a déjà validé qu'elle vise REDIRECT_URI).
    const cb = new URL(callbackUrl)
    res = await fetch(`${base}${cb.pathname}${cb.search}`, { headers: { cookie: app.header() }, redirect: 'manual' })
    app.store(res)
    expect(res.status, logs).toBe(302)
    expect(res.headers.get('location')).toBe('/mail/INBOX')

    const folders = await fetch(`${base}/api/folders`, { headers: { cookie: app.header() } })
    expect(folders.status, logs).toBe(200)
    expect(((await folders.json()) as Folder[]).some(f => f.path === 'INBOX')).toBe(true)

    const filters = (await (await fetch(`${base}/api/filters`, { headers: { cookie: app.header() } })).json()) as FiltersStatus
    expect(filters.available).toBe(true)
    expect(filters.capabilities).toContain('fileinto')

    const subject = unique('Colombe SAML envoi')
    const send = await fetch(`${base}/api/send`, {
      method: 'POST',
      headers: { cookie: app.header(), 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ to: [USER2.email], cc: [], bcc: [], subject, text: 'Envoyé après une connexion fédérée SAML.' }),
    })
    expect(send.status, logs).toBe(204)
    await waitForMailpit(subject)
  })
})
