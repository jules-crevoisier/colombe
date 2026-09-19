/**
 * Intégration réelle de la connexion unique : Apereo CAS 7.1.6 (fournisseur OIDC, image
 * construite localement depuis le gabarit officiel apereo/cas-overlay-template, branche 7.1)
 * + Dovecot 2.4 qui valide les jetons d'accès par introspection (bloc `oauth2 { }`) + Mailpit
 * (relais de la soumission SMTP). Deuxième banc OIDC, miroir de sso.dovecot.test.ts (Keycloak)
 * — voir docker-compose.cas.yml et tests/integration/cas/.
 *
 * Deux niveaux :
 *   1. bibliothèques de Colombe (IMAP, ManageSieve, SMTP) avec un jeton CAS réel obtenu par
 *      le vrai formulaire de connexion CAS (flux code d'autorisation + PKCE — voir
 *      docs/admin/connexion-unique.md, §CAS, pour pourquoi le grant « password » n'est pas
 *      utilisable ici malgré son support par CAS), en XOAUTH2 et OAUTHBEARER ;
 *   2. serveur Colombe construit (.output) : connexion par le formulaire CAS, boîte, filtres,
 *      envoi, avec OIDC_EMAIL_CLAIM=mail puis OIDC_EMAIL_CLAIM=uid + MAIL_LOGIN_DEFAULT_DOMAIN.
 *
 * Lancer : docker compose -f docker-compose.cas.yml up -d --wait, puis `pnpm test:cas`.
 * Ignoré automatiquement si CAS (localhost:8444) ou Dovecot (127.0.0.1:3146) n'écoute pas.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FiltersStatus, Folder, ForwardSettings } from '#shared/types/mail'
import type { MailCredentials, MailServerConfig } from '../../server/lib/mail/backend'
import { ImapBackend, verifyImapCredentials } from '../../server/lib/mail/imap'
import { SieveClient } from '../../server/lib/sieve/client'
import type { SieveConfig } from '../../server/lib/sieve/client'

const CAS = 'http://localhost:8444/cas'
const ISSUER = `${CAS}/oidc`
const CLIENT_ID = 'colombe'
const CLIENT_SECRET = 'colombe-cas-test-secret'
const REDIRECT_URI = 'http://localhost:39322/api/auth/oidc/callback'
const MAILPIT = 'http://127.0.0.1:18026'
const DEV = { user: 'dev', password: 'dev-sso-password', email: 'dev@universite.example' }
const ALICE = { user: 'alice', password: 'alice-sso-password', email: 'alice@universite.example' }
/** Port fixe : seule URI de redirection déclarée pour le client « colombe » (etc/cas/services/colombe-10001.json). */
const COLOMBE_PORT = 39322

function listening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host)
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

const reachable = (await listening(8444)) && (await listening(3146)) && (await listening(4192))

const oauth2Server = (mechanism: 'xoauth2' | 'oauthbearer'): MailServerConfig => ({
  imapHost: '127.0.0.1',
  imapPort: 3146,
  imapSecure: false,
  imapServername: 'localhost',
  smtpHost: '127.0.0.1',
  smtpPort: 3588,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpServername: 'localhost',
  tlsRejectUnauthorized: false, // certificat auto-signé de l'image Dovecot
  loginUsername: 'email',
  mailSso: { mode: 'oauth2', mechanism },
})
const sieveConfig: SieveConfig = { host: '127.0.0.1', port: 4192, rejectUnauthorized: false, servername: 'localhost' }

interface TokenResponse {
  access_token: string
  id_token: string
  refresh_token?: string
  expires_in: number
}

/** Petit pot à cookies, comme un navigateur — même principe que sso.dovecot.test.ts. */
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

/**
 * Pilote le formulaire de connexion CAS jusqu'au retour chez le fournisseur de service
 * (Colombe ou, dans casToken(), la redirect_uri de test). `casUrl` : l'URL de départ chez
 * CAS (celle vers laquelle le service — Colombe ou l'appel direct à oidcAuthorize — a
 * redirigé). Contrairement à Keycloak, CAS répond à /oidc/oidcAuthorize par une redirection
 * séparée vers /login?service=… avant de servir le formulaire — un saut de plus, géré ici.
 * Retourne l'URL finale (chez le service cible, avec ?code=… ou tout autre paramètre).
 */
async function casFormLogin(cas: Jar, casUrl: URL, account: { user: string, password: string }): Promise<URL> {
  let url = casUrl
  let res = await fetch(url, { headers: { cookie: cas.header() }, redirect: 'manual' })
  cas.store(res)
  if (res.status === 302) {
    url = new URL(res.headers.get('location')!)
    res = await fetch(url, { headers: { cookie: cas.header() }, redirect: 'manual' })
    cas.store(res)
  }
  expect(res.status, `page de connexion CAS → ${res.status}`).toBe(200)
  const html = await res.text()
  const action = /<form[^>]*id="fm1"[^>]*action="([^"]+)"/.exec(html)?.[1]
  const execution = /name="execution" value="([^"]+)"/.exec(html)?.[1]
  expect(action, 'formulaire CAS introuvable (fm1)').toBeTruthy()
  expect(execution, 'champ execution introuvable dans le formulaire CAS').toBeTruthy()
  const postUrl = new URL(action!.replace(/&amp;/g, '&'), url)
  res = await fetch(postUrl, {
    method: 'POST',
    headers: { cookie: cas.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: account.user, password: account.password, execution: execution!, _eventId: 'submit', geolocation: '' }),
    redirect: 'manual',
  })
  cas.store(res)
  expect(res.status, `connexion CAS → ${res.status}`).toBe(302)
  // oauth2.0/callbackAuthorize → oidc/oidcAuthorize (session SSO déjà là) → service cible.
  let loc = res.headers.get('location')!
  for (let hop = 0; hop < 5 && loc && new URL(loc).origin === url.origin; hop++) {
    res = await fetch(loc, { headers: { cookie: cas.header() }, redirect: 'manual' })
    cas.store(res)
    expect(res.status, `étape ${hop} du retour CAS → ${res.status}`).toBe(302)
    loc = res.headers.get('location')!
  }
  return new URL(loc)
}

/**
 * Jeton réel via le vrai formulaire de connexion CAS (flux code d'autorisation + PKCE S256).
 * CAS 7.1.6 supporte bien le grant « password » (RFC 7662-style ROPC, activé pour le client
 * « colombe » via supportedGrantTypes) mais son jeton porte un « sub » différent (l'identifiant
 * CAS nu, ex. « dev ») de celui obtenu par ce flux (l'adresse de messagerie, via
 * usernameAttributeProvider sur etc/cas/services/colombe-10001.json) — voir
 * docs/admin/connexion-unique.md, §CAS. Dovecot compare le « sub » d'introspection à
 * l'identité SASL envoyée par Colombe (toujours l'adresse), donc seul le jeton obtenu par ce
 * flux fonctionne avec Dovecot ; c'est aussi le flux réellement utilisé en production.
 * Le formulaire CAS exige un champ « execution » (jeton anti-rejeu propre au webflow Spring),
 * contrairement au formulaire Keycloak plus simple.
 */
async function casToken(account: { user: string, password: string }): Promise<TokenResponse> {
  const jar = new Jar()
  const verifier = `${account.user}-${Date.now()}-${Math.random().toString(36).slice(2)}-pkce-verifier-min-43-chars-long-ok`
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorizeQs = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    state: 'probe-state',
    nonce: 'probe-nonce',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const finalUrl = await casFormLogin(jar, new URL(`${ISSUER}/oidcAuthorize?${authorizeQs}`), account)
  expect(finalUrl.origin + finalUrl.pathname, `redirect_uri inattendue : ${finalUrl}`).toBe(REDIRECT_URI)
  const code = finalUrl.searchParams.get('code')
  expect(code, `code d'autorisation absent de ${finalUrl}`).toBeTruthy()

  const tokenRes = await fetch(`${ISSUER}/oidcAccessToken`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT_URI, code_verifier: verifier }),
  })
  expect(tokenRes.status, await tokenRes.clone().text()).toBe(200)
  return (await tokenRes.json()) as TokenResponse
}

function oauth2Creds(email: string, token: TokenResponse): MailCredentials {
  return { email, auth: { kind: 'oauth2', accessToken: token.access_token, refreshToken: token.refresh_token ?? '', expiresAt: Date.now() + token.expires_in * 1000 } }
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
  Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Date.now()}@colombe.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEnvoyé avec un jeton CAS.\r\n`)

describe.skipIf(!reachable)('SSO réel : CAS 7.1.6 + Dovecot 2.4 (oauth2) — bibliothèques', () => {
  it('IMAP : le jeton d\'accès CAS (flux code+PKCE) ouvre la boîte, XOAUTH2 puis OAUTHBEARER', async () => {
    const token = await casToken(DEV)
    const creds = oauth2Creds(DEV.email, token)
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

  it('IMAP : refuse un jeton invalide, et le jeton d\'un autre utilisateur', async () => {
    expect(await verifyImapCredentials(oauth2Creds(DEV.email, { access_token: 'jeton-invalide', id_token: '', expires_in: 60 }), oauth2Server('xoauth2'))).toBe(false)
    const aliceToken = await casToken(ALICE)
    expect(await verifyImapCredentials(oauth2Creds(DEV.email, aliceToken), oauth2Server('xoauth2'))).toBe(false)
  })

  it('ManageSieve : AUTHENTICATE XOAUTH2 puis OAUTHBEARER avec le jeton', async () => {
    const token = await casToken(DEV)
    for (const kind of ['xoauth2', 'oauthbearer'] as const) {
      const client = await SieveClient.connect(sieveConfig, { kind, user: DEV.email, accessToken: token.access_token })
      try {
        expect(Array.isArray(await client.listScripts())).toBe(true)
        expect(client.sieveExtensions()).toContain('fileinto')
      }
      finally {
        await client.logout()
      }
    }
  })

  it('ManageSieve : jeton refusé → AUTH_FAILED rapidement (pas d\'attente de 10 s)', async () => {
    for (const kind of ['xoauth2', 'oauthbearer'] as const) {
      const started = Date.now()
      await expect(SieveClient.connect(sieveConfig, { kind, user: DEV.email, accessToken: 'jeton-invalide' })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
      expect(Date.now() - started).toBeLessThan(9000)
    }
  })

  it('SMTP (soumission Dovecot) : AUTH XOAUTH2 puis AUTH OAUTHBEARER, message relayé', async () => {
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      const token = await casToken(DEV)
      const backend = new ImapBackend(oauth2Creds(DEV.email, token), oauth2Server(mechanism))
      const subject = unique(`SSO CAS ${mechanism}`)
      try {
        await backend.send(rawMessage(DEV.email, ALICE.email, subject), { from: DEV.email, to: [ALICE.email] })
      }
      finally {
        await backend.close()
      }
      await waitForMailpit(subject)
    }
  })

  it('SMTP : un jeton invalide est refusé (AUTH_FAILED)', async () => {
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      const backend = new ImapBackend(oauth2Creds(DEV.email, { access_token: 'jeton-invalide', id_token: '', expires_in: 60 }), oauth2Server(mechanism))
      await expect(backend.send(rawMessage(DEV.email, ALICE.email, 'refusé'), { from: DEV.email, to: [ALICE.email] })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
      await backend.close()
    }
  })

  it('grant « password » (ROPC) : CAS émet bien un jeton, mais son « sub » (identifiant nu) ne correspond pas à l\'adresse envoyée par Colombe en SASL — IMAP le refuse', async () => {
    const res = await fetch(`${ISSUER}/oidcAccessToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, username: DEV.user, password: DEV.password, scope: 'openid email profile' }),
    })
    expect(res.status, await res.clone().text()).toBe(200)
    const ropc = (await res.json()) as TokenResponse
    const payload = JSON.parse(Buffer.from(ropc.id_token.split('.')[1]!, 'base64url').toString()) as { sub: string }
    expect(payload.sub).toBe(DEV.user) // « dev », pas « dev@universite.example »
    // Le jeton est réel et valide (CAS l'accepterait pour lui-même) mais Dovecot refuse :
    // introspection renvoie sub=dev, alors que Colombe présente dev@universite.example en SASL.
    expect(await verifyImapCredentials(oauth2Creds(DEV.email, ropc), oauth2Server('xoauth2'))).toBe(false)
  })
})

// ─── Serveur Colombe construit, connexion par le vrai formulaire CAS ───

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

describe.skipIf(!reachable)('SSO réel : CAS 7.1.6 + Dovecot 2.4 — serveur Colombe', () => {
  let server: ChildProcess | null = null
  let dataDir = ''
  let logs = ''
  const base = `http://localhost:${COLOMBE_PORT}`

  class Browser {
    app = new Jar()
    cas = new Jar()

    async request(path: string, init: { method?: string, body?: unknown } = {}): Promise<Response> {
      const headers: Record<string, string> = { cookie: this.app.header() }
      if (init.method && init.method !== 'GET') headers.origin = base
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      const res = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: 'manual' })
      this.app.store(res)
      return res
    }

    /**
     * Formulaire de connexion CAS (voir casFormLogin) jusqu'au retour chez Colombe. Renvoie
     * la Location finale (page Colombe après traitement du callback OIDC).
     */
    async casLogin(startPath: string, account: { user: string, password: string }): Promise<string> {
      const start = await this.request(startPath)
      expect(start.status).toBe(302)
      const startUrl = new URL(start.headers.get('location')!)
      expect(startUrl.origin).toBe('http://localhost:8444')
      const back = await casFormLogin(this.cas, startUrl, account)
      expect(back.origin).toBe(base)
      const callback = await this.request(`${back.pathname}${back.search}`)
      expect(callback.status).toBe(302)
      return callback.headers.get('location') ?? ''
    }
  }

  async function spawnColombe(env: Record<string, string>): Promise<{ proc: ChildProcess, dir: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'webmail-cas-it-'))
    const proc = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(COLOMBE_PORT),
        HOST: 'localhost',
        NODE_ENV: 'production',
        MAIL_BACKEND: 'imap',
        MAIL_HOST: '127.0.0.1',
        MAIL_IMAP_PORT: '3146',
        MAIL_IMAP_SECURE: 'false',
        MAIL_SMTP_PORT: '3588',
        MAIL_SMTP_SECURE: 'false',
        MAIL_SIEVE_PORT: '4192',
        MAIL_TLS_SERVERNAME: 'localhost',
        MAIL_TLS_REJECT_UNAUTHORIZED: 'false',
        WEBMAIL_ALLOW_INSECURE_TLS: '1',
        MAIL_DOMAINS: 'universite.example',
        AUTH_METHODS: 'oidc',
        OIDC_ISSUER: ISSUER,
        OIDC_CLIENT_ID: CLIENT_ID,
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_SCOPES: 'openid email profile',
        MAIL_SSO_AUTH: 'oauth2',
        MAIL_OAUTH_MECHANISM: 'xoauth2',
        NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-characters-long',
        WEBMAIL_DATA_KEY: 'test-data-key-at-least-32-characters-long-xx',
        WEBMAIL_DATA_DIR: dir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); logs += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); logs += d.toString() })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`Le serveur s'est arrêté :\n${out}`)
      try {
        if ((await fetch(`http://localhost:${COLOMBE_PORT}/api/config`)).ok) return { proc, dir }
      }
      catch {
        // pas encore prêt
      }
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`Serveur non prêt après 30 s :\n${out}`)
  }

  async function stopColombe(proc: ChildProcess | null, dir: string): Promise<void> {
    if (proc && proc.exitCode === null) {
      const exited = new Promise(resolve => proc.once('exit', resolve))
      proc.kill()
      await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
    }
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:cas` (nuxt build puis ce fichier).')
    const started = await spawnColombe({ OIDC_EMAIL_CLAIM: 'mail' })
    server = started.proc
    dataDir = started.dir
  }, 60_000)

  afterAll(async () => {
    const proc = server
    server = null
    await stopColombe(proc, dataDir)
  })

  it('connexion par CAS (OIDC_EMAIL_CLAIM=mail) : boîte IMAP, filtres ManageSieve et envoi SMTP', async () => {
    const b = new Browser()
    expect(await b.casLogin('/api/auth/oidc/start', DEV), logs).toBe('/mail/INBOX')

    const folders = await b.request('/api/folders')
    expect(folders.status, logs).toBe(200)
    expect(((await folders.json()) as Folder[]).some(f => f.path === 'INBOX')).toBe(true)

    const filters = (await (await b.request('/api/filters')).json()) as FiltersStatus
    expect(filters.available).toBe(true)
    expect(filters.capabilities).toContain('fileinto')

    const subject = unique('Colombe CAS envoi')
    const send = await b.request('/api/send', { method: 'POST', body: { to: [ALICE.email], cc: [], bcc: [], subject, text: 'Envoyé après connexion CAS.' } })
    expect(send.status, logs).toBe(204)
    await waitForMailpit(subject)
  })

  it('transfert : réauthentification CAS (prompt=login, max_age=0) exigée puis acceptée', async () => {
    const b = new Browser()
    await b.casLogin('/api/auth/oidc/start', DEV)
    const forward = { enabled: true, address: ALICE.email, keepCopy: true }
    expect((await b.request('/api/filters/forward', { method: 'PUT', body: forward })).status).toBe(403)

    expect(await b.casLogin('/api/auth/oidc/start?reauth=1&returnTo=%2Fsettings%3Ftab%3Dforward', DEV)).toBe('/settings?tab=forward&reauth=ok')
    const accepted = await b.request('/api/filters/forward', { method: 'PUT', body: forward })
    expect(accepted.status, logs).toBe(200)
    expect((await accepted.json()) as ForwardSettings).toEqual(forward)
    expect((await b.request('/api/filters/forward', { method: 'PUT', body: { enabled: false, address: ALICE.email, keepCopy: true } })).status).toBe(200)
  })

  it('déconnexion : end_session_endpoint de CAS (oidcLogout)', async () => {
    const b = new Browser()
    await b.casLogin('/api/auth/oidc/start', DEV)
    const res = await b.request('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    const url = new URL(((await res.json()) as { redirect: string }).redirect)
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/oidcLogout`)
    expect((await b.request('/api/folders')).status).toBe(401)
  })
})

describe.skipIf(!reachable)('SSO réel : CAS 7.1.6 — repli OIDC_EMAIL_CLAIM=uid + MAIL_LOGIN_DEFAULT_DOMAIN', () => {
  let server: ChildProcess | null = null
  let dataDir = ''

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:cas` (nuxt build puis ce fichier).')
    const dir = mkdtempSync(join(tmpdir(), 'webmail-cas-uid-it-'))
    server = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(COLOMBE_PORT),
        HOST: 'localhost',
        NODE_ENV: 'production',
        MAIL_BACKEND: 'imap',
        MAIL_HOST: '127.0.0.1',
        MAIL_IMAP_PORT: '3146',
        MAIL_IMAP_SECURE: 'false',
        MAIL_SMTP_PORT: '3588',
        MAIL_SMTP_SECURE: 'false',
        MAIL_SIEVE_PORT: '4192',
        MAIL_TLS_SERVERNAME: 'localhost',
        MAIL_TLS_REJECT_UNAUTHORIZED: 'false',
        WEBMAIL_ALLOW_INSECURE_TLS: '1',
        MAIL_DOMAINS: 'universite.example',
        MAIL_LOGIN_DEFAULT_DOMAIN: 'universite.example',
        AUTH_METHODS: 'oidc',
        OIDC_ISSUER: ISSUER,
        OIDC_CLIENT_ID: CLIENT_ID,
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_SCOPES: 'openid email profile',
        OIDC_EMAIL_CLAIM: 'uid', // CAS ne renvoie qu'un identifiant nu ("dev") pour ce claim
        MAIL_SSO_AUTH: 'oauth2',
        MAIL_OAUTH_MECHANISM: 'xoauth2',
        NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-characters-long',
        WEBMAIL_DATA_KEY: 'test-data-key-at-least-32-characters-long-xx',
        WEBMAIL_DATA_DIR: dir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    dataDir = dir
    let out = ''
    server.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    server.stderr?.on('data', (d: Buffer) => { out += d.toString() })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Le serveur s'est arrêté :\n${out}`)
      try {
        if ((await fetch(`http://localhost:${COLOMBE_PORT}/api/config`)).ok) return
      }
      catch { /* pas encore prêt */ }
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`Serveur non prêt après 30 s :\n${out}`)
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

  it('connexion par CAS avec OIDC_EMAIL_CLAIM=uid : Colombe complète l\'adresse avec MAIL_LOGIN_DEFAULT_DOMAIN', async () => {
    const base = `http://localhost:${COLOMBE_PORT}`
    const app = new Jar()
    const cas = new Jar()
    async function request(path: string): Promise<Response> {
      const res = await fetch(`${base}${path}`, { headers: { cookie: app.header() }, redirect: 'manual' })
      app.store(res)
      return res
    }
    const start = await request('/api/auth/oidc/start')
    expect(start.status).toBe(302)
    const back = await casFormLogin(cas, new URL(start.headers.get('location')!), DEV)
    expect(back.origin).toBe(base)
    const callback = await request(`${back.pathname}${back.search}`)
    // dev (uid) + universite.example (MAIL_LOGIN_DEFAULT_DOMAIN) = dev@universite.example, accepté.
    expect(callback.status, callback.status === 302 ? '' : await callback.text()).toBe(302)
    expect(callback.headers.get('location')).toBe('/mail/INBOX')

    const folders = await request('/api/folders')
    expect(folders.status).toBe(200)
  })
})
