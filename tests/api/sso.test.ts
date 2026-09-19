/**
 * Connexion unique OpenID Connect, de bout en bout : serveur Nitro construit (.output)
 * démarré par CE fichier avec AUTH_METHODS=oidc et le backend mémoire, face à un vrai
 * fournisseur OIDC en processus (tests/support/oidc-idp.ts, oidc-provider).
 *
 * Couvre : start → fournisseur → callback (session utilisable), refus state/nonce,
 * domaine étranger, connexion par mot de passe désactivée (404), déconnexion chez le
 * fournisseur, réauthentification pour une action sensible, double authentification
 * Colombe après la connexion unique, rafraîchissement du jeton d'accès.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PublicConfig } from '#shared/types/config'
import type { ForwardSettings, TwoFactorSetup } from '#shared/types/mail'
import { totpAt } from '../../server/lib/auth/totp'
import { startTestIdp } from '../support/oidc-idp'
import type { TestAccount, TestIdp } from '../support/oidc-idp'

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`
const CLIENT_ID = 'colombe'
const CLIENT_SECRET = 'colombe-test-client-secret'
const PORTAL = 'https://ent.universite.example/'

const DEV: TestAccount = { sub: 'uid-dev', email: 'dev@universite.example', email_verified: true, name: 'Dev Webmail' }
const ALICE: TestAccount = { sub: 'uid-alice', email: 'alice@universite.example', email_verified: true }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/** Petit bocal à cookies (nom → valeur), un par « navigateur » et par site. */
class Jar {
  private cookies = new Map<string, string>()

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const eq = pair?.indexOf('=') ?? -1
      if (!pair || eq < 1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired = /max-age=0/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line)
      if (!value || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value)
  }
}

describe('Connexion unique OpenID Connect (AUTH_METHODS=oidc)', () => {
  let server: ChildProcess | null = null
  let idp: TestIdp
  let base = ''
  let dataDir = ''
  let logs = ''

  /** Un navigateur : cookies Colombe + cookies du fournisseur d'identité. */
  class Browser {
    app = new Jar()
    idp = new Jar()

    async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
      const headers: Record<string, string> = {}
      const cookie = this.app.header()
      if (cookie) headers.cookie = cookie
      if (init.method && init.method !== 'GET') headers.origin = base
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      const res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual',
      })
      this.app.store(res)
      return res
    }

    /** Suit les redirections chez le fournisseur jusqu'au retour vers Colombe ; renvoie l'URL de retour. */
    async throughIdp(authorizeUrl: string): Promise<URL> {
      let next = new URL(authorizeUrl)
      for (let i = 0; i < 10; i++) {
        if (next.origin === base) return next
        const res = await fetch(next, { headers: { cookie: this.idp.header() }, redirect: 'manual' })
        this.idp.store(res)
        const location = res.headers.get('location')
        expect(location, `fournisseur ${next.pathname} → ${res.status} ${await res.clone().text().catch(() => '')}`).toBeTruthy()
        next = new URL(location!, next)
      }
      throw new Error('Trop de redirections chez le fournisseur')
    }

    /** GET /api/auth/oidc/start → URL d'autorisation chez le fournisseur. */
    async start(query = ''): Promise<URL> {
      const res = await this.request(`/api/auth/oidc/start${query}`)
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('location')!)
      expect(location.origin).toBe(idp.issuer)
      expect(this.app.get('wm_oidc')).toBeTruthy()
      return location
    }

    /** Retour vers /api/auth/oidc/callback → Location finale (chemin relatif). */
    async callback(callbackUrl: URL): Promise<string> {
      const res = await this.request(`${callbackUrl.pathname}${callbackUrl.search}`)
      expect(res.status).toBe(302)
      return res.headers.get('location') ?? ''
    }

    async ssoLogin(account: TestAccount, query = ''): Promise<string> {
      idp.loginAs(account)
      const authorize = await this.start(query)
      return this.callback(await this.throughIdp(authorize.href))
    }

    async session(): Promise<Record<string, unknown>> {
      return (await (await this.request('/api/_auth/session')).json()) as Record<string, unknown>
    }
  }

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:api` (nuxt build puis tests).')
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    // Jeton d'accès de 30 s : sous la marge de rafraîchissement (60 s), chaque requête rafraîchit.
    idp = await startTestIdp({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUris: [`${base}/api/auth/oidc/callback`],
      postLogoutRedirectUris: [`${base}/login`],
      accessTokenTtl: 30,
    })

    dataDir = mkdtempSync(join(tmpdir(), 'webmail-sso-'))
    server = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        MAIL_BACKEND: 'mock',
        WEBMAIL_ALLOW_MOCK: '1',
        NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-characters-long',
        WEBMAIL_DATA_KEY: 'test-data-key-at-least-32-characters-long-xx',
        WEBMAIL_DATA_DIR: dataDir,
        AUTH_METHODS: 'oidc',
        OIDC_ISSUER: idp.issuer,
        OIDC_CLIENT_ID: CLIENT_ID,
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        COLOMBE_PORTAL_URL: PORTAL,
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
  })

  afterAll(async () => {
    const proc = server
    server = null
    if (proc && proc.exitCode === null) {
      const exited = new Promise(resolve => proc.once('exit', resolve))
      proc.kill()
      await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
    }
    await idp?.close()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('GET /api/config annonce la connexion unique et le portail, sans rien de secret', async () => {
    const res = await fetch(`${base}/api/config`)
    const config = (await res.json()) as PublicConfig
    expect(config.login.methods).toEqual(['oidc'])
    expect(config.login.oidc).toEqual({ label: 'Se connecter avec mon compte de l\'établissement' })
    expect(config.portalUrl).toBe(PORTAL)
    const raw = JSON.stringify(config)
    expect(raw).not.toContain(CLIENT_SECRET)
    expect(raw).not.toContain(idp.issuer)
  })

  it('POST /api/auth/login répond 404 quand « password » n\'est pas dans AUTH_METHODS', async () => {
    const res = await new Browser().request('/api/auth/login', { method: 'POST', body: { email: 'dev@universite.example', password: 'dev-password' } })
    expect(res.status).toBe(404)
  })

  it('start → fournisseur → callback : session ouverte, boîte accessible, rien de secret côté navigateur', async () => {
    const b = new Browser()
    const authorize = await b.start('?returnTo=%2Fsettings%3Ftab%3Dforward')
    expect(authorize.pathname).toBe('/auth')
    const p = authorize.searchParams
    expect(p.get('client_id')).toBe(CLIENT_ID)
    expect(p.get('response_type')).toBe('code')
    expect(p.get('redirect_uri')).toBe(`${base}/api/auth/oidc/callback`)
    expect(p.get('scope')).toBe('openid email profile offline_access')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(p.get('state')).toBeTruthy()
    expect(p.get('nonce')).toBeTruthy()
    expect(p.get('prompt')).toBeNull()

    idp.loginAs(DEV)
    const location = await b.callback(await b.throughIdp(authorize.href))
    expect(location).toBe('/settings?tab=forward')
    // Cookie d'état à usage unique : effacé au retour.
    expect(b.app.get('wm_oidc')).toBeUndefined()

    const session = await b.session()
    expect(session.user).toEqual({ email: 'dev@universite.example' })
    expect(session.authMethod).toBe('oidc')
    expect(session.secure).toBeUndefined()
    expect(JSON.stringify(session)).not.toMatch(/token/i)

    expect((await b.request('/api/folders')).status).toBe(200)
    // Sessions actives : la session SSO y figure comme les autres.
    const sessions = (await (await b.request('/api/account/sessions')).json()) as { sessions?: unknown[] } | unknown[]
    expect(JSON.stringify(sessions)).toContain('"current":true')
  })

  it('returnTo absent ou hors application : /mail/INBOX', async () => {
    expect(await new Browser().ssoLogin(DEV)).toBe('/mail/INBOX')
    expect(await new Browser().ssoLogin(DEV, '?returnTo=%2F%2Fevil.example')).toBe('/mail/INBOX')
    expect(await new Browser().ssoLogin(DEV, '?returnTo=https%3A%2F%2Fevil.example%2F')).toBe('/mail/INBOX')
    expect(await new Browser().ssoLogin(DEV, '?returnTo=%2F%5Cevil.example')).toBe('/mail/INBOX')
  })

  it('rafraîchit le jeton d\'accès avec le jeton de rafraîchissement, côté serveur', async () => {
    const b = new Browser()
    await b.ssoLogin(DEV)
    const before = idp.refreshes()
    expect((await b.request('/api/folders')).status).toBe(200)
    expect(idp.refreshes()).toBeGreaterThan(before)
    expect((await b.request('/api/messages?folder=INBOX')).status).toBe(200)
  })

  it('refuse un state modifié (et ne rejoue pas un retour sans cookie d\'état)', async () => {
    const b = new Browser()
    idp.loginAs(DEV)
    const back = await b.throughIdp((await b.start()).href)
    const tampered = new URL(back)
    tampered.searchParams.set('state', 'etat-forge')
    expect(await b.callback(tampered)).toBe('/login?error=invalid')
    expect((await b.request('/api/folders')).status).toBe(401)
    expect(logs).toMatch(/\[colombe\] auth-failure ip=\S+ user=-/)

    // Le cookie d'état a été consommé : rejouer le vrai retour échoue aussi.
    expect(await b.callback(back)).toBe('/login?error=expired')
    expect((await b.request('/api/folders')).status).toBe(401)
  })

  it('refuse un jeton d\'identité dont le nonce ne correspond pas', async () => {
    const b = new Browser()
    idp.loginAs(DEV)
    const authorize = await b.start()
    authorize.searchParams.set('nonce', 'nonce-forge')
    expect(await b.callback(await b.throughIdp(authorize.href))).toBe('/login?error=invalid')
    expect((await b.request('/api/folders')).status).toBe(401)
  })

  it('refuse une adresse d\'un domaine étranger, ou une adresse absente', async () => {
    expect(await new Browser().ssoLogin({ sub: 'uid-pirate', email: 'pirate@gmail.com', email_verified: true })).toBe('/login?error=domain')
    expect(logs).toContain('user=pirate@gmail.com')
    expect(await new Browser().ssoLogin({ sub: 'uid-sans-adresse' })).toBe('/login?error=claim')
    expect(await new Browser().ssoLogin({ sub: 'uid-non-verifie', email: 'dev@universite.example', email_verified: false })).toBe('/login?error=claim')
    // Domaine accepté mais aucune boîte : refus côté messagerie.
    expect(await new Browser().ssoLogin({ sub: 'uid-bob', email: 'bob@universite.example', email_verified: true })).toBe('/login?error=mailbox')
  })

  it('annulation chez le fournisseur : /login?error=cancelled', async () => {
    const b = new Browser()
    const authorize = await b.start()
    const back = new URL(`${base}/api/auth/oidc/callback`)
    back.searchParams.set('error', 'access_denied')
    back.searchParams.set('state', authorize.searchParams.get('state')!)
    expect(await b.callback(back)).toBe('/login?error=cancelled')
  })

  it('déconnexion : session détruite et redirection vers end_session_endpoint (id_token_hint, retour sur /login)', async () => {
    const b = new Browser()
    await b.ssoLogin(DEV)
    const res = await b.request('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    const { redirect } = (await res.json()) as { redirect: string | null }
    const url = new URL(redirect!)
    expect(`${url.origin}${url.pathname}`).toBe(`${idp.issuer}/session/end`)
    expect(url.searchParams.get('id_token_hint')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${base}/login`)
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect((await b.request('/api/folders')).status).toBe(401)
  })

  it('action sensible : 403 sans confirmation, puis accepte après une réauthentification récente chez le fournisseur', async () => {
    const b = new Browser()
    await b.ssoLogin(DEV)
    const forward = { enabled: true, address: 'alice@universite.example', keepCopy: true }

    const refused = await b.request('/api/filters/forward', { method: 'PUT', body: forward })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { message: string }).message).toBe('Confirmez votre identité auprès de votre établissement.')
    // Pas de mot de passe côté Colombe : un « mot de passe » quelconque n'ouvre rien.
    expect((await b.request('/api/filters/forward', { method: 'PUT', body: { ...forward, confirmPassword: 'dev-password' } })).status).toBe(403)

    const logins = idp.logins()
    const authorize = await b.start('?reauth=1&returnTo=%2Fsettings%3Ftab%3Dforward')
    expect(authorize.searchParams.get('prompt')).toBe('login')
    expect(authorize.searchParams.get('max_age')).toBe('0')
    idp.loginAs(DEV)
    expect(await b.callback(await b.throughIdp(authorize.href))).toBe('/settings?tab=forward&reauth=ok')
    // prompt=login : le fournisseur a bien redemandé l'identification malgré sa session.
    expect(idp.logins()).toBe(logins + 1)

    const accepted = await b.request('/api/filters/forward', { method: 'PUT', body: forward })
    expect(accepted.status).toBe(200)
    expect((await accepted.json()) as ForwardSettings).toEqual(forward)
  })

  it('réauthentification avec un autre compte : refusée, la session reste sans confirmation', async () => {
    const b = new Browser()
    await b.ssoLogin(DEV)
    const authorize = await b.start('?reauth=1&returnTo=%2Fsettings')
    // Quelqu'un d'autre s'identifie chez le fournisseur (nouvelle session côté fournisseur).
    b.idp = new Jar()
    idp.loginAs(ALICE)
    expect(await b.callback(await b.throughIdp(authorize.href))).toBe('/settings?reauth=failed')
    const session = await b.session()
    expect(session.user).toEqual({ email: 'dev@universite.example' })
    const res = await b.request('/api/filters/forward', { method: 'PUT', body: { enabled: true, address: 'alice@universite.example', keepCopy: true } })
    expect(res.status).toBe(403)
  })

  it('double authentification Colombe activée : code demandé après la connexion unique', async () => {
    const setupBrowser = new Browser()
    await setupBrowser.ssoLogin(ALICE)
    const setup = (await (await setupBrowser.request('/api/account/2fa/setup', { method: 'POST' })).json()) as TwoFactorSetup
    const now = () => Math.floor(Date.now() / 1000)
    expect((await setupBrowser.request('/api/account/2fa/enable', { method: 'POST', body: { code: totpAt(setup.secret, now()) } })).status).toBe(200)

    const b = new Browser()
    expect(await b.ssoLogin(ALICE)).toBe('/login?step=2fa')
    expect((await b.request('/api/folders')).status).toBe(401)
    expect((await b.session()).user).toBeUndefined()

    const ok = await b.request('/api/auth/2fa', { method: 'POST', body: { code: totpAt(setup.secret, now() + 30) } })
    expect(ok.status).toBe(200)
    const session = await b.session()
    expect(session.user).toEqual({ email: 'alice@universite.example' })
    expect(session.authMethod).toBe('oidc')
    expect((await b.request('/api/folders')).status).toBe(200)
    // La déconnexion d'une session SSO ouverte après le code passe toujours par le fournisseur.
    const logout = await b.request('/api/auth/logout', { method: 'POST' })
    expect(((await logout.json()) as { redirect: string }).redirect).toContain('id_token_hint=')
  })

  it('sans AUTH_METHODS=oidc (serveur partagé des tests API) : routes OIDC absentes', async () => {
    const shared = inject('apiBase')
    expect((await fetch(`${shared}/api/auth/oidc/start`, { redirect: 'manual' })).status).toBe(404)
    expect((await fetch(`${shared}/api/auth/oidc/callback?code=x&state=y`, { redirect: 'manual' })).status).toBe(404)
    const config = (await (await fetch(`${shared}/api/config`)).json()) as PublicConfig
    expect(config.login.methods).toEqual(['password'])
    expect(config.login.oidc).toBeNull()
  })
})
