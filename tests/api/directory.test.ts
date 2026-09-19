/**
 * Contrat de GET /api/directory/search (annuaire de l'établissement). Serveur Nitro
 * construit (.output) démarré par CE fichier, en pointant sur l'OpenLDAP de
 * docker-compose.ldap.yml (docker compose -f docker-compose.ldap.yml up -d) — comme
 * tests/api/demo.test.ts, un contrat différent (LDAP_URL défini) qui ne doit pas
 * polluer le serveur partagé de tests/api/global-setup.ts (sans LDAP, voir le test
 * « 404 quand l'annuaire n'est pas configuré » plus bas, qui utilise CE serveur-là).
 *
 * Ignoré automatiquement si le conteneur n'écoute pas sur 127.0.0.1:3389.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { DirectoryEntry } from '#shared/types/mail'

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(3389, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

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

interface Client {
  cookie: string
  request: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>
  json: <T>(path: string) => Promise<T>
}

describe('GET /api/directory/search : 404 quand l\'annuaire n\'est pas configuré', () => {
  // Serveur partagé de tests/api/global-setup.ts : aucune variable LDAP_* n'y est
  // définie (voir tests/api/distribution.test.ts qui vérifie features.directory=false).
  const base = inject('apiBase')
  const url = (path: string) => `${base}${path}`
  const origin = () => new URL(url('/')).origin

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

  async function login(): Promise<Client> {
    const c = client()
    const res = await c.request('/api/auth/login', { method: 'POST', body: { email: 'dev@universite.example', password: 'dev-password' } })
    expect(res.status).toBe(200)
    return c
  }

  it('404 même authentifié : la route n\'existe pas sans LDAP_URL', async () => {
    const c = await login()
    const res = await c.request('/api/directory/search?q=Dupont')
    expect(res.status).toBe(404)
  })
})

describe.skipIf(!reachable)('GET /api/directory/search (annuaire configuré, OpenLDAP réel)', () => {
  let server: ChildProcess | null = null
  let base = ''
  let dataDir = ''

  const url = (path: string) => `${base}${path}`
  const origin = () => new URL(base).origin

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

  async function login(): Promise<Client> {
    const c = client()
    const res = await c.request('/api/auth/login', { method: 'POST', body: { email: 'dev@universite.example', password: 'dev-password' } })
    expect(res.status).toBe(200)
    return c
  }

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:api` (nuxt build puis tests).')

    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    dataDir = mkdtempSync(join(tmpdir(), 'webmail-directory-'))
    let logs = ''
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
        // Le backend mock utilise universite.example par défaut : mêmes domaines que
        // docker/ldap/bootstrap.ldif, pour que le filtrage MAIL_DOMAINS soit visible.
        LDAP_URL: 'ldap://127.0.0.1:3389',
        LDAP_BASE_DN: 'dc=universite,dc=example',
        LDAP_BIND_DN: 'cn=admin,dc=universite,dc=example',
        LDAP_BIND_PASSWORD: 'admin-test-password',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (d: Buffer) => { logs += d.toString() })
    server.stderr?.on('data', (d: Buffer) => { logs += d.toString() })

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Le serveur s'est arrêté :\n${logs}`)
      try {
        const res = await fetch(`${base}/api/config`)
        if (res.ok) return
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

  it('GET /api/config : features.directory === true', async () => {
    const res = await fetch(url('/api/config'))
    const body = await res.json() as { features: { directory: boolean } }
    expect(body.features).toEqual({ directory: true })
  })

  it('401 sans session', async () => {
    const res = await client().request('/api/directory/search?q=Dupont')
    expect(res.status).toBe(401)
  })

  it('400 : requête plus courte que LDAP_MIN_QUERY (défaut 3)', async () => {
    const c = await login()
    const res = await c.request('/api/directory/search?q=ab')
    expect(res.status).toBe(400)
  })

  it('400 : paramètre q absent', async () => {
    const c = await login()
    const res = await c.request('/api/directory/search')
    expect(res.status).toBe(400)
  })

  it('200 : trouve une personne, forme exacte de DirectoryEntry', async () => {
    const c = await login()
    const results = await c.json<DirectoryEntry[]>('/api/directory/search?q=Dupont')
    expect(results).toHaveLength(1)
    const [entryResult] = results
    expect(Object.keys(entryResult!).sort()).toEqual(['affiliation', 'department', 'email', 'name', 'phone', 'title'].sort())
    expect(entryResult).toEqual({
      name: 'Jean Dupont',
      email: 'jean.dupont@universite.example',
      phone: '+33325000001',
      title: 'Maître de conférences',
      department: 'Informatique',
      affiliation: null,
    })
  })

  it('recherche insensible à la casse, prénom accentué', async () => {
    const c = await login()
    const results = await c.json<DirectoryEntry[]>('/api/directory/search?q=eleonore')
    expect(results.some(r => r.name === 'Éléonore Béranger')).toBe(true)
  })

  it('ne renvoie jamais une adresse hors domaine (MAIL_DOMAINS)', async () => {
    const c = await login()
    const results = await c.json<DirectoryEntry[]>('/api/directory/search?q=Partenaire')
    expect(results).toEqual([])
  })

  it('tentative d\'injection dans le filtre : réponse 200 propre, jamais toute la base', async () => {
    const c = await login()
    const res = await c.request(`/api/directory/search?q=${encodeURIComponent('*)(uid=*')}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as DirectoryEntry[]
    expect(results).toEqual([])
  })

  it('429 après LDAP_MIN_QUERY... 30 requêtes dans la même minute (par session)', async () => {
    const c = await login()
    let lastStatus = 200
    for (let i = 0; i < 32; i++) {
      const res = await c.request('/api/directory/search?q=Dupont')
      lastStatus = res.status
      if (res.status === 429) break
    }
    expect(lastStatus).toBe(429)
  })
})
