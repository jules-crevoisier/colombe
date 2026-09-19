/**
 * Contrat de distribution : santé, config publique, branding, connexion,
 * profils d'appareils (mobileconfig/settings), autoconfig Thunderbird et
 * autodiscover Outlook. Serveur construit, backend mémoire — voir global-setup.ts.
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'

const base = inject('apiBase')
const url = (path: string) => `${base}${path}`
const origin = () => new URL(url('/')).origin

interface Client {
  cookie: string
  request: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>
  json: <T>(path: string) => Promise<T>
}

function client(): Client {
  const c: Client = {
    cookie: '',
    async request(path, init = {}) {
      const headers: Record<string, string> = { ...init.headers }
      if (c.cookie) headers.cookie = c.cookie
      if (init.method && init.method !== 'GET') headers.origin ??= origin()
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      const res = await fetch(url(path), {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual',
      })
      const setCookie = res.headers.getSetCookie().find(v => v.startsWith('wm_session='))
      if (setCookie) c.cookie = setCookie.split(';')[0] ?? ''
      return res
    },
    async json<T>(path: string) {
      const res = await c.request(path)
      expect(res.status, `${path} → ${res.status}`).toBe(200)
      return (await res.json()) as T
    },
  }
  return c
}

async function login(email = 'dev@universite.example', password = email.startsWith('dev') ? 'dev-password' : 'alice-password'): Promise<Client> {
  const c = client()
  const res = await c.request('/api/auth/login', { method: 'POST', body: { email, password } })
  expect(res.status).toBe(200)
  return c
}

const OUTLOOK_REQUEST = (emailAddress: string) =>
  `<?xml version="1.0" encoding="utf-8"?><Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006"><Request><EMailAddress>${emailAddress}</EMailAddress><AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema></Request></Autodiscover>`

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('santé', () => {
  it('GET /api/health → 200 avec un statut ok, une version semver et sans cache', async () => {
    const res = await fetch(url('/api/health'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json() as { status: string, version: string }
    expect(body.status).toBe('ok')
    expect(body.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/)
  })
})

describe('config publique', () => {
  it('GET /api/config → 200 avec exactement les clés attendues et aucun secret dans le corps brut', async () => {
    const res = await fetch(url('/api/config'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const raw = await res.text()
    for (const secret of ['mail.univ-exemple.fr', 'localhost', '127.0.0.1', 'test-session-password-at-least-32-characters-long', 'test-data-key-at-least-32-characters-long-xx']) {
      expect(raw).not.toContain(secret)
    }
    const body = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['defaultLanguage', 'demo', 'features', 'hasLogo', 'limits', 'login', 'loginMessage', 'orgName', 'passwordResetUrl', 'portalUrl', 'productName', 'supportEmail', 'supportUrl'].sort())
    expect(body).toMatchObject({
      productName: 'Colombe',
      orgName: 'Université Exemple',
      passwordResetUrl: 'https://mdp.univ-exemple.fr/',
      supportUrl: null,
      hasLogo: false,
      demo: null,
      // Pas de LDAP_URL dans global-setup.ts : annuaire désactivé par défaut.
      features: { directory: false },
      portalUrl: null,
      // Pas de COLOMBE_DEFAULT_LANGUAGE dans global-setup.ts : français par défaut.
      defaultLanguage: 'fr',
    })
    expect(body.login).toEqual({ domains: ['universite.example'], defaultDomain: 'universite.example', methods: ['password'], oidc: null })
    expect(body.limits).toEqual({ attachmentsBytes: 10 * 1024 * 1024 })
  })
})

describe('branding', () => {
  it('GET /api/branding/logo → 404 quand aucun logo n\'est configuré', async () => {
    const res = await fetch(url('/api/branding/logo'))
    expect(res.status).toBe(404)
  })
})

describe('connexion : normalisation et refus', () => {
  it('accepte un identifiant local sans domaine et ouvre bien une session', async () => {
    const c = client()
    const res = await c.request('/api/auth/login', { method: 'POST', body: { email: 'dev', password: 'dev-password' } })
    expect(res.status).toBe(200)
    const body = await res.json() as { user: { email: string } }
    expect(body.user.email).toBe('dev@universite.example')
    expect((await c.request('/api/folders')).status).toBe(200)
  })

  it('normalise casse et espaces autour de l\'adresse', async () => {
    const res = await client().request('/api/auth/login', { method: 'POST', body: { email: '  DEV@UNIVERSITE.EXAMPLE ', password: 'dev-password' } })
    expect(res.status).toBe(200)
    const body = await res.json() as { user: { email: string } }
    expect(body.user.email).toBe('dev@universite.example')
  })

  it('refuse un domaine étranger (403), y compris un sous-domaine piégé', async () => {
    expect((await client().request('/api/auth/login', { method: 'POST', body: { email: 'dev@gmail.com', password: 'x' } })).status).toBe(403)
    expect((await client().request('/api/auth/login', { method: 'POST', body: { email: 'dev@universite.example.evil.com', password: 'x' } })).status).toBe(403)
  })

  it('refuse un mauvais mot de passe pour un compte du domaine (401)', async () => {
    const res = await client().request('/api/auth/login', { method: 'POST', body: { email: 'dev@universite.example', password: 'mauvais' } })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/devices/settings', () => {
  it('refuse sans session (401)', async () => {
    expect((await client().request('/api/devices/settings')).status).toBe(401)
  })

  it('renvoie les paramètres serveur complets pour dev', async () => {
    const c = await login()
    const body = await c.json<Record<string, unknown>>('/api/devices/settings')
    expect(body).toEqual({
      email: 'dev@universite.example',
      username: 'dev@universite.example',
      imap: { host: 'mail.univ-exemple.fr', port: 993, security: 'ssl' },
      smtp: { host: 'mail.univ-exemple.fr', port: 587, security: 'starttls' },
      forwardDomains: ['universite.example'],
      productName: 'Colombe',
    })
  })
})

describe('GET /api/devices/apple.mobileconfig', () => {
  it('refuse sans session (401)', async () => {
    expect((await client().request('/api/devices/apple.mobileconfig')).status).toBe(401)
  })

  it('renvoie un plist XML téléchargeable avec les infos IMAP mais sans mot de passe', async () => {
    const c = await login()
    const res = await c.request('/api/devices/apple.mobileconfig')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/x-apple-aspen-config/)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-disposition')).toContain('.mobileconfig')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const body = await res.text()
    expect(body).toContain('<plist')
    expect(body).toContain('EmailTypeIMAP')
    expect(body).toContain('dev@universite.example')
    expect(body).toContain('mail.univ-exemple.fr')
    expect(body).toContain('993')
    expect(body).toContain('587')
    // Clés Apple qui porteraient un mot de passe. `OutgoingPasswordSameAsIncomingPassword`
    // (booléen, sans valeur secrète) est autorisée.
    for (const bad of ['dev-password', '<key>IncomingPassword</key>', '<key>OutgoingPassword</key>']) {
      expect(body).not.toContain(bad)
    }
  })

  it('renvoie le même PayloadUUID pour deux téléchargements du même utilisateur, et un profil différent pour alice', async () => {
    const dev = await login()
    const first = await (await dev.request('/api/devices/apple.mobileconfig')).text()
    const second = await (await dev.request('/api/devices/apple.mobileconfig')).text()
    const extractUuids = (xml: string) => xml.match(/<key>PayloadUUID<\/key>\s*<string>([^<]+)<\/string>/g)
    expect(extractUuids(first)).toEqual(extractUuids(second))

    const alice = await login('alice@universite.example')
    const aliceBody = await (await alice.request('/api/devices/apple.mobileconfig')).text()
    expect(aliceBody).not.toBe(first)
  })
})

describe('autoconfig Thunderbird', () => {
  it('GET /mail/config-v1.1.xml → 200 XML avec les serveurs IMAP/SMTP, sans mot de passe', async () => {
    const res = await fetch(url('/mail/config-v1.1.xml'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('xml')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const body = await res.text()
    expect(body).toContain('<clientConfig')
    expect(body).toContain('<domain>universite.example</domain>')
    expect(body).toMatch(/<incomingServer[^>]*type="imap"/)
    expect(body).toContain('<hostname>mail.univ-exemple.fr</hostname>')
    expect(body).toContain('<port>993</port>')
    expect(body).toContain('<socketType>SSL</socketType>')
    expect(body).toContain('<username>%EMAILADDRESS%</username>')
    expect(body).toMatch(/<outgoingServer[^>]*type="smtp"/)
    expect(body).toContain('<port>587</port>')
    expect(body).toContain('<socketType>STARTTLS</socketType>')
    expect(body).not.toContain('dev-password')
  })

  it('GET /.well-known/autoconfig/mail/config-v1.1.xml (avec emailaddress) → 200 XML', async () => {
    const res = await fetch(url('/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=dev%40universite.example'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('xml')
    const body = await res.text()
    expect(body).toContain('<clientConfig')
    expect(body).toContain('<domain>universite.example</domain>')
    expect(body).toContain('<hostname>mail.univ-exemple.fr</hostname>')
  })
})

describe('autodiscover Outlook', () => {
  it('POST /autodiscover/autodiscover.xml → 200 avec les serveurs et le LoginName pour un compte du domaine', async () => {
    const res = await fetch(url('/autodiscover/autodiscover.xml'), {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: OUTLOOK_REQUEST('dev@universite.example'),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Type>IMAP</Type>')
    expect(body).toContain('<Type>SMTP</Type>')
    expect(body).toContain('<Server>mail.univ-exemple.fr</Server>')
    expect(body).toContain('<Port>993</Port>')
    expect(body).toContain('<LoginName>dev@universite.example</LoginName>')
  })

  it('fonctionne aussi sur la casse historique /Autodiscover/Autodiscover.xml', async () => {
    const res = await fetch(url('/Autodiscover/Autodiscover.xml'), {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: OUTLOOK_REQUEST('dev@universite.example'),
    })
    expect(res.status).toBe(200)
  })

  it('ne renvoie pas de LoginName pour une adresse hors domaine', async () => {
    const res = await fetch(url('/autodiscover/autodiscover.xml'), {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: OUTLOOK_REQUEST('someone@other.org'),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('<LoginName>')
  })

  it('échappe les caractères spéciaux et ne laisse passer aucune injection XML dans la réponse', async () => {
    const escaped = await fetch(url('/autodiscover/autodiscover.xml'), {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: OUTLOOK_REQUEST('a&lt;x&gt;"@universite.example'),
    })
    expect(escaped.status).toBe(200)
    const escapedBody = await escaped.text()
    expect(escapedBody).not.toContain('<Evil>')
    expect(escapedBody).not.toContain('<LoginName>')

    const injection = await fetch(url('/autodiscover/autodiscover.xml'), {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: OUTLOOK_REQUEST('x</LoginName><Evil>@universite.example'),
    })
    expect(injection.status).toBe(200)
    const injectionBody = await injection.text()
    expect(injectionBody).not.toContain('<Evil>')
    expect(injectionBody).not.toContain('<LoginName>')
  })
})
