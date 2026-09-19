/**
 * Intégration réelle de la connexion unique : Keycloak 26 (fournisseur OIDC) + Dovecot 2.4
 * qui valide les jetons d'accès par introspection (bloc `oauth2 { }`) + Mailpit (relais de
 * la soumission SMTP). Voir docker-compose.sso.yml et tests/integration/sso/.
 *
 * Deux niveaux :
 *   1. bibliothèques de Colombe (IMAP, ManageSieve, SMTP) avec un jeton Keycloak réel,
 *      en XOAUTH2 et OAUTHBEARER, rafraîchissement, et mode utilisateur maître ;
 *   2. serveur Colombe construit (.output) : connexion par le formulaire Keycloak, boîte,
 *      filtres, envoi, réauthentification (prompt=login) pour un transfert, déconnexion.
 *
 * Lancer : docker compose -f docker-compose.sso.yml up -d --wait, puis `pnpm test:sso`.
 * Ignoré automatiquement si Keycloak (localhost:8180) ou Dovecot (127.0.0.1:3145) n'écoute pas.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
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
import { getOidcConfiguration, refreshTokens } from '../../server/lib/auth/oidc/client'
import type { OidcConfig } from '../../server/lib/config'

const KEYCLOAK = 'http://localhost:8180'
const ISSUER = `${KEYCLOAK}/realms/colombe`
const CLIENT_ID = 'colombe'
const CLIENT_SECRET = 'colombe-sso-test-secret'
const MAILPIT = 'http://127.0.0.1:18025'
const MASTER = { mode: 'master' as const, masterUser: 'colombe', masterPassword: 'colombe-master-password-for-tests-only', separator: '*' }
const DEV = { user: 'dev', password: 'dev-sso-password', email: 'dev@universite.example' }
const ALICE = { user: 'alice', password: 'alice-sso-password', email: 'alice@universite.example' }
/** Port fixe : seule URL de retour déclarée dans le royaume Keycloak de test. */
const COLOMBE_PORT = 39321

function listening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host)
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

const reachable = (await listening(8180)) && (await listening(3145)) && (await listening(4191))

const oauth2Server = (mechanism: 'xoauth2' | 'oauthbearer'): MailServerConfig => ({
  imapHost: '127.0.0.1',
  imapPort: 3145,
  imapSecure: false,
  imapServername: 'localhost',
  smtpHost: '127.0.0.1',
  smtpPort: 3587,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpServername: 'localhost',
  tlsRejectUnauthorized: false, // certificat auto-signé de l'image Dovecot
  loginUsername: 'email',
  mailSso: { mode: 'oauth2', mechanism },
})
const sieveConfig: SieveConfig = { host: '127.0.0.1', port: 4191, rejectUnauthorized: false, servername: 'localhost' }
const oidcConfig: OidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  scopes: 'openid email profile',
  emailClaim: 'email',
  buttonLabel: '',
  logout: true,
  redirectUrl: null,
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

/** Jeton réel (grant « password », activé pour le seul client de test). */
async function keycloakToken(account: { user: string; password: string }): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, username: account.user, password: account.password, scope: 'openid email' }),
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
  Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Date.now()}@colombe.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEnvoyé avec un jeton OIDC.\r\n`)

describe.skipIf(!reachable)('SSO réel : Keycloak + Dovecot 2.4 (oauth2) — bibliothèques', () => {
  it('IMAP : le jeton d\'accès Keycloak ouvre la boîte (imapflow choisit OAUTHBEARER, annoncé par Dovecot)', async () => {
    const token = await keycloakToken(DEV)
    const creds = oauth2Creds(DEV.email, token)
    expect(await verifyImapCredentials(creds, oauth2Server('xoauth2'))).toBe(true)
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
    expect(await verifyImapCredentials(oauth2Creds(DEV.email, { access_token: 'jeton-invalide', refresh_token: '', expires_in: 60 }), oauth2Server('xoauth2'))).toBe(false)
    const aliceToken = await keycloakToken(ALICE)
    expect(await verifyImapCredentials(oauth2Creds(DEV.email, aliceToken), oauth2Server('xoauth2'))).toBe(false)
  })

  it('ManageSieve : AUTHENTICATE XOAUTH2 puis OAUTHBEARER avec le jeton', async () => {
    const token = await keycloakToken(DEV)
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
      // Délai d'échec de Dovecot (auth_failure_delay) compris, mais jamais le délai de commande (10 s).
      expect(Date.now() - started).toBeLessThan(9000)
    }
  })

  it('SMTP (soumission Dovecot) : AUTH XOAUTH2 puis AUTH OAUTHBEARER, message relayé', async () => {
    for (const mechanism of ['xoauth2', 'oauthbearer'] as const) {
      const token = await keycloakToken(DEV)
      const backend = new ImapBackend(oauth2Creds(DEV.email, token), oauth2Server(mechanism))
      const subject = unique(`SSO ${mechanism}`)
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
      const backend = new ImapBackend(oauth2Creds(DEV.email, { access_token: 'jeton-invalide', refresh_token: '', expires_in: 60 }), oauth2Server(mechanism))
      await expect(backend.send(rawMessage(DEV.email, ALICE.email, 'refusé'), { from: DEV.email, to: [ALICE.email] })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
      await backend.close()
    }
  })

  it('rafraîchissement (openid-client) : le nouveau jeton ouvre IMAP ; l\'objet auth muté est repris à la reconnexion', async () => {
    const token = await keycloakToken(DEV)
    const refreshed = await refreshTokens(await getOidcConfiguration(oidcConfig), token.refresh_token)
    expect(refreshed.accessToken).not.toBe(token.access_token)
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now())
    const creds = oauth2Creds(DEV.email, { access_token: 'perime', refresh_token: '', expires_in: 1 })
    const backend = new ImapBackend(creds, oauth2Server('xoauth2'))
    try {
      // Comme CredentialsStore.updateOAuth : mutation en place, même référence.
      if (creds.auth.kind === 'oauth2') creds.auth.accessToken = refreshed.accessToken
      expect((await backend.listFolders()).some(f => f.path === 'INBOX')).toBe(true)
    }
    finally {
      await backend.close()
    }
  })

  it('mode master : IMAP « utilisateur*maître », ManageSieve et SMTP en PLAIN avec authzid', async () => {
    const server: MailServerConfig = { ...oauth2Server('xoauth2'), mailSso: MASTER }
    const creds: MailCredentials = { email: DEV.email, auth: { kind: 'master' } }
    expect(await verifyImapCredentials(creds, server)).toBe(true)
    expect(await verifyImapCredentials(creds, { ...server, mailSso: { ...MASTER, masterPassword: 'mauvais-mot-de-passe-maitre-xx' } })).toBe(false)

    const sieve = await SieveClient.connect(sieveConfig, { kind: 'plain', user: MASTER.masterUser, password: MASTER.masterPassword, authzid: DEV.email })
    expect(Array.isArray(await sieve.listScripts())).toBe(true)
    await sieve.logout()

    const backend = new ImapBackend(creds, server)
    const subject = unique('SSO master')
    try {
      await backend.send(rawMessage(DEV.email, ALICE.email, subject), { from: DEV.email, to: [ALICE.email] })
    }
    finally {
      await backend.close()
    }
    await waitForMailpit(subject)
  })
})

// ─── Serveur Colombe construit, connexion par le vrai formulaire Keycloak ───

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

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

describe.skipIf(!reachable)('SSO réel : Keycloak + Dovecot 2.4 — serveur Colombe', () => {
  let server: ChildProcess | null = null
  let dataDir = ''
  let logs = ''
  const base = `http://localhost:${COLOMBE_PORT}`

  class Browser {
    app = new Jar()
    kc = new Jar()

    async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
      const headers: Record<string, string> = { cookie: this.app.header() }
      if (init.method && init.method !== 'GET') headers.origin = base
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      const res = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: 'manual' })
      this.app.store(res)
      return res
    }

    /** Formulaire de connexion Keycloak : GET de la page puis POST des identifiants. Renvoie la Location finale chez Colombe. */
    async keycloakLogin(startPath: string, account: { user: string; password: string }): Promise<string> {
      const start = await this.request(startPath)
      expect(start.status).toBe(302)
      let url = new URL(start.headers.get('location')!)
      expect(url.origin).toBe(KEYCLOAK)
      let res = await fetch(url, { headers: { cookie: this.kc.header() }, redirect: 'manual' })
      this.kc.store(res)
      if (res.status === 200) {
        const html = await res.text()
        const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1]
        expect(action, 'formulaire Keycloak introuvable').toBeTruthy()
        url = new URL(action!.replace(/&amp;/g, '&'))
        res = await fetch(url, {
          method: 'POST',
          headers: { cookie: this.kc.header(), 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username: account.user, password: account.password, credentialId: '' }),
          redirect: 'manual',
        })
        this.kc.store(res)
      }
      expect(res.status, `Keycloak → ${res.status}`).toBe(302)
      const back = new URL(res.headers.get('location')!)
      expect(back.origin).toBe(base)
      const callback = await this.request(`${back.pathname}${back.search}`)
      expect(callback.status).toBe(302)
      return callback.headers.get('location') ?? ''
    }
  }

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:sso` (nuxt build puis ce fichier).')
    dataDir = mkdtempSync(join(tmpdir(), 'webmail-sso-it-'))
    server = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(COLOMBE_PORT),
        HOST: 'localhost',
        NODE_ENV: 'production',
        MAIL_BACKEND: 'imap',
        MAIL_HOST: '127.0.0.1',
        MAIL_IMAP_PORT: '3145',
        MAIL_IMAP_SECURE: 'false',
        MAIL_SMTP_PORT: '3587',
        MAIL_SMTP_SECURE: 'false',
        MAIL_SIEVE_PORT: '4191',
        MAIL_TLS_SERVERNAME: 'localhost',
        MAIL_TLS_REJECT_UNAUTHORIZED: 'false',
        WEBMAIL_ALLOW_INSECURE_TLS: '1', // certificat auto-signé du conteneur de test
        MAIL_DOMAINS: 'universite.example',
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

  it('connexion par Keycloak : boîte IMAP, filtres ManageSieve et envoi SMTP avec le jeton', async () => {
    const b = new Browser()
    expect(await b.keycloakLogin('/api/auth/oidc/start', DEV), logs).toBe('/mail/INBOX')

    const folders = await b.request('/api/folders')
    expect(folders.status, logs).toBe(200)
    expect(((await folders.json()) as Folder[]).some(f => f.path === 'INBOX')).toBe(true)

    const filters = (await (await b.request('/api/filters')).json()) as FiltersStatus
    expect(filters.available).toBe(true)
    expect(filters.capabilities).toContain('fileinto')

    const subject = unique('Colombe SSO envoi')
    const send = await b.request('/api/send', { method: 'POST', body: { to: [ALICE.email], cc: [], bcc: [], subject, text: 'Envoyé après connexion Keycloak.' } })
    expect(send.status, logs).toBe(204)
    await waitForMailpit(subject)
  })

  it('transfert : réauthentification Keycloak (prompt=login, max_age=0) exigée puis acceptée', async () => {
    const b = new Browser()
    await b.keycloakLogin('/api/auth/oidc/start', DEV)
    const forward = { enabled: true, address: ALICE.email, keepCopy: true }
    expect((await b.request('/api/filters/forward', { method: 'PUT', body: forward })).status).toBe(403)

    // Keycloak a une session : prompt=login force quand même le formulaire.
    expect(await b.keycloakLogin('/api/auth/oidc/start?reauth=1&returnTo=%2Fsettings%3Ftab%3Dforward', DEV)).toBe('/settings?tab=forward&reauth=ok')
    const accepted = await b.request('/api/filters/forward', { method: 'PUT', body: forward })
    expect(accepted.status, logs).toBe(200)
    expect((await accepted.json()) as ForwardSettings).toEqual(forward)
    // Remise à zéro (fenêtre de confirmation encore ouverte).
    expect((await b.request('/api/filters/forward', { method: 'PUT', body: { enabled: false, address: ALICE.email, keepCopy: true } })).status).toBe(200)
  })

  it('déconnexion : end_session_endpoint de Keycloak avec id_token_hint et retour sur /login', async () => {
    const b = new Browser()
    await b.keycloakLogin('/api/auth/oidc/start', DEV)
    const res = await b.request('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    const url = new URL(((await res.json()) as { redirect: string }).redirect)
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/protocol/openid-connect/logout`)
    expect(url.searchParams.get('id_token_hint')).toBeTruthy()
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${base}/login`)
    expect((await b.request('/api/folders')).status).toBe(401)
    // Keycloak accepte la demande (URL de retour déclarée) : redirection vers /login.
    const kc = await fetch(url, { headers: { cookie: b.kc.header() }, redirect: 'manual' })
    expect([200, 302]).toContain(kc.status)
  })
})
