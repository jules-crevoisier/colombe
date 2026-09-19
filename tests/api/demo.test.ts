/**
 * Démo publique (COLOMBE_DEMO=true) : contrat de server/api/auth/demo.post.ts,
 * server/lib/demo/accounts.ts et le blocage de la connexion par mot de passe.
 *
 * Serveur Nitro construit (.output) démarré par CE fichier, en démo — pas celui de
 * tests/api/global-setup.ts (backend mémoire « normal », partagé par les autres
 * fichiers de ce projet vitest) : la démo a un contrat différent (mock forcé,
 * login désactivé, /api/__mock/reset absent) qui ne doit pas polluer les autres tests.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LoginResult, MessagePage } from '#shared/types/mail'
import type { PublicConfig } from '#shared/types/config'

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

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

describe('Démo publique (COLOMBE_DEMO=true)', () => {
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

  async function demoLogin(headers?: Record<string, string>): Promise<{ client: Client; email: string }> {
    const c = client()
    const res = await c.request('/api/auth/demo', { method: 'POST', headers })
    expect(res.status, `POST /api/auth/demo → ${res.status}`).toBe(200)
    const body = (await res.json()) as LoginResult
    expect(body.user?.email).toMatch(/^visiteur-[0-9a-f]{8}@/)
    return { client: c, email: body.user!.email }
  }

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:api` (nuxt build puis tests).')

    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    dataDir = mkdtempSync(join(tmpdir(), 'webmail-demo-'))
    let logs = ''
    server = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        MAIL_BACKEND: 'mock',
        COLOMBE_DEMO: 'true',
        // Pas de WEBMAIL_ALLOW_MOCK : la démo autorise seule le backend mémoire en production.
        NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-characters-long',
        WEBMAIL_DATA_KEY: 'test-data-key-at-least-32-characters-long-xx',
        WEBMAIL_DATA_DIR: dataDir, // ignoré en démo (base :memory:), gardé par hygiène
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

  describe('GET /api/config', () => {
    it('expose demo { ttlHours, projectUrl }', async () => {
      const res = await fetch(url('/api/config'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as PublicConfig
      expect(body.demo).toEqual({ ttlHours: 4, projectUrl: null })
    })
  })

  describe('POST /api/auth/login', () => {
    it('403 : la connexion par mot de passe est désactivée en démo', async () => {
      const res = await client().request('/api/auth/login', { method: 'POST', body: { email: 'dev@universite.example', password: 'dev-password' } })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { message?: string }
      expect(body.message).toBe('La connexion par mot de passe est désactivée dans la démo.')
    })
  })

  describe('POST /api/__mock/reset', () => {
    it('404 : n\'existe pas en démo', async () => {
      const res = await client().request('/api/__mock/reset', { method: 'POST' })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/auth/demo', () => {
    it('crée un compte visiteur isolé et ouvre une session', async () => {
      const { client: c, email } = await demoLogin()
      const folders = await c.json('/api/folders')
      expect(Array.isArray(folders)).toBe(true)
      expect((folders as Array<{ total: number }>).some(f => f.total > 0)).toBe(true)

      // La boîte « Bienvenue » ne doit pas s'ouvrir : prefs.welcomed déjà vrai, nom « Visiteur ».
      const identities = await c.json<Array<{ isDefault: boolean; name: string }>>('/api/identities')
      expect(identities.find(i => i.isDefault)?.name).toBe('Visiteur')

      void email
    })

    it('deux visiteurs sont isolés : ni boîtes, ni messages envoyés partagés', async () => {
      const a = await demoLogin()
      const b = await demoLogin()
      expect(a.email).not.toBe(b.email)

      const subjectA = `Isolation démo A ${Date.now()}`
      const sendRes = await a.client.request('/api/send', {
        method: 'POST',
        body: { to: [b.email], subject: subjectA, text: 'Message de A vers B.' },
      })
      expect(sendRes.status).toBe(204)

      // Toujours conservé dans le dossier Envoyés de A...
      const sentA = await a.client.json<MessagePage>(`/api/messages?folder=${encodeURIComponent('INBOX.Envoyés')}&pageSize=100`)
      expect(sentA.items.some(m => m.subject === subjectA)).toBe(true)

      // ...mais jamais livré à B : le backend mémoire ne délivre qu'aux comptes fixes
      // (dev/alice), jamais à une autre boîte de démo — aucune connexion réseau n'est ouverte.
      const inboxB = await b.client.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
      expect(inboxB.items.some(m => m.subject === subjectA)).toBe(false)
      const sentB = await b.client.json<MessagePage>(`/api/messages?folder=${encodeURIComponent('INBOX.Envoyés')}&pageSize=100`)
      expect(sentB.items.some(m => m.subject === subjectA)).toBe(false)
    })

    it('Accept-Language: en → boîte d\'échantillon anglaise et pref.language "en"', async () => {
      const { client: c } = await demoLogin({ 'accept-language': 'en' })

      const inbox = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
      expect(inbox.items.some(m => m.subject === 'The Campus Newsletter — September')).toBe(true)
      expect(inbox.items.some(m => m.subject.includes('Facture'))).toBe(false)

      const prefs = await c.json<{ language: string }>('/api/prefs')
      expect(prefs.language).toBe('en')
    })

    it('Accept-Language: fr (ou absent) → boîte d\'échantillon française et pref.language "fr"', async () => {
      const { client: cFr } = await demoLogin({ 'accept-language': 'fr' })
      const inboxFr = await cFr.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
      expect(inboxFr.items.some(m => m.subject === 'La lettre du campus — septembre')).toBe(true)
      const prefsFr = await cFr.json<{ language: string }>('/api/prefs')
      expect(prefsFr.language).toBe('fr')

      // En-tête absent : comportement historique inchangé (français par défaut).
      const { client: cAbsent } = await demoLogin()
      const inboxAbsent = await cAbsent.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
      expect(inboxAbsent.items.some(m => m.subject === 'La lettre du campus — septembre')).toBe(true)
    })

    it('deux visiteurs de langues différentes sont isolés (aucune fuite de contenu entre boîtes)', async () => {
      const { client: cEn } = await demoLogin({ 'accept-language': 'en' })
      const { client: cFr } = await demoLogin({ 'accept-language': 'fr' })

      const inboxEn = await cEn.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
      const inboxFr = await cFr.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
      expect(inboxEn.items.some(m => m.subject === 'La lettre du campus — septembre')).toBe(false)
      expect(inboxFr.items.some(m => m.subject === 'The Campus Newsletter — September')).toBe(false)
    })

    it('429 après 10 créations depuis la même adresse IP', async () => {
      // Un seul test consomme ce budget : les autres `it` de ce fichier ont déjà appelé
      // /api/auth/demo plusieurs fois, mais chaque test Vitest est un budget partagé par
      // IP pour tout le fichier (même serveur, même limiteur) — on complète jusqu'à 10.
      let lastStatus = 200
      for (let i = 0; i < 12; i++) {
        const res = await client().request('/api/auth/demo', { method: 'POST' })
        lastStatus = res.status
        if (res.status === 429) break
      }
      expect(lastStatus).toBe(429)
    })
  })
})
