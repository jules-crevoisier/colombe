/**
 * Intégration réelle : filtres Sieve et réponse automatique contre Dovecot 2.4.1 +
 * Pigeonhole (docker compose up -d dovecot). Voir docs/PLAN-v4.md section F et
 * docs/ROADMAP.md section F. C'est la seule preuve qui compte : un filtre réellement
 * exécuté à la livraison, et une réponse automatique réellement renvoyée.
 *
 * Ce fichier démarre lui-même un serveur Nitro construit (.output) en backend IMAP
 * réel pointé sur le conteneur (comme tests/api/global-setup.ts, mais avec son propre
 * beforeAll/afterAll et des variables d'environnement différentes — cf. note ci-dessous
 * sur le projet vitest dédié).
 *
 * Lancer : docker compose up -d dovecot, puis `pnpm test:dovecot`.
 * Ignoré automatiquement si ManageSieve (127.0.0.1:4190) n'écoute pas.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FilterRule, Folder, MessagePage, VacationSettings } from '#shared/types/mail'

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = `${root}.output/server/index.mjs`

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(4190, '127.0.0.1')
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

const rand = () => Math.random().toString(36).slice(2, 9)
const userA = `it-${Date.now()}-${rand()}@mmi-troyes.fr`
const userB = `it-${Date.now()}-${rand()}@mmi-troyes.fr`
const DOVECOT_PASSWORD = 'dovecot-test-password'

interface Client {
  cookie: string
  request: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>
  json: <T>(path: string) => Promise<T>
}

describe.skipIf(!reachable)('Filtres Sieve contre Dovecot + Pigeonhole (réel)', () => {
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

  async function login(email: string): Promise<Client> {
    const c = client()
    const res = await c.request('/api/auth/login', { method: 'POST', body: { email, password: DOVECOT_PASSWORD } })
    expect(res.status, `login ${email} → ${res.status}`).toBe(200)
    return c
  }

  async function deliverByLmtp(to: string, from: string, subject: string, text: string): Promise<void> {
    const transport = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 3024,
      lmtp: true,
      secure: true,
      tls: { rejectUnauthorized: false },
    })
    const info = await transport.sendMail({ from, to, subject, text })
    expect(info.accepted.map(String)).toContain(to)
  }

  async function waitForSubject(c: Client, folder: string, subject: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const page = await c.json<MessagePage>(`/api/messages?folder=${encodeURIComponent(folder)}&pageSize=100`)
      const found = page.items.find(m => m.subject === subject)
      if (found) return found
      await new Promise(r => setTimeout(r, 500))
    }
    throw new Error(`« ${subject} » n'est jamais arrivé dans ${folder} après ${timeoutMs} ms`)
  }

  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Build absent : lancez `pnpm test:dovecot` (nuxt build puis ce fichier).')

    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    dataDir = mkdtempSync(join(tmpdir(), 'webmail-dovecot-'))
    let logs = ''
    server = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        // Hypothèse (à vérifier avec l'implémentation) : mêmes noms que
        // tests/api/global-setup.ts (NUXT_MAIL_BACKEND), étendus par symétrie aux
        // autres clés de MailServerConfig (host, imapPort, imapSecure, sievePort,
        // tlsRejectUnauthorized). Voir « ambiguïtés » dans le rapport.
        NUXT_MAIL_BACKEND: 'imap',
        NUXT_MAIL_HOST: '127.0.0.1',
        NUXT_MAIL_IMAP_PORT: '3144',
        NUXT_MAIL_IMAP_SECURE: 'false',
        NUXT_MAIL_SIEVE_PORT: '4190',
        NUXT_MAIL_TLS_REJECT_UNAUTHORIZED: 'false',
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
        const res = await fetch(`${base}/api/_auth/session`)
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

  it('should deliver a matching message into the target folder, and not into INBOX, once the filter is active', async () => {
    const c = await login(userA)

    const folderRes = await c.request('/api/folders', { method: 'POST', body: { name: 'Projets' } })
    expect(folderRes.status).toBe(201)
    const folder = (await folderRes.json()) as Folder

    const setRes = await c.request('/api/filters/sets', { method: 'POST', body: { name: 'colombe' } })
    expect(setRes.status).toBe(201)

    const rule: FilterRule = {
      id: 'r-mmi',
      name: 'Objet contient [MMI] → Projets',
      enabled: true,
      match: 'all',
      conditions: [{ field: 'subject', op: 'contains', value: '[MMI]' }],
      actions: [{ type: 'move', folder: folder.path }],
    }
    const putRes = await c.request('/api/filters/sets/colombe', { method: 'PUT', body: { rules: [rule] } })
    expect(putRes.status).toBe(200)

    const activateRes = await c.request('/api/filters/sets/colombe/activate', { method: 'POST' })
    expect(activateRes.status).toBe(204)

    await deliverByLmtp(userA, 'bob@mmi-troyes.fr', '[MMI] test filtre', 'Corps du message de test.')

    const delivered = await waitForSubject(c, folder.path, '[MMI] test filtre')
    expect(delivered.folder).toBe(folder.path)

    const inbox = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    expect(inbox.items.some(m => m.subject === '[MMI] test filtre')).toBe(false)
  }, 30_000)

  it('should auto-reply to the sender once vacation is enabled', async () => {
    const a = await login(userA)
    const vacation: VacationSettings = {
      enabled: true,
      from: null,
      until: null,
      subject: 'Absent(e)',
      message: 'Je suis actuellement absent(e), réponse à mon retour.',
      days: 1,
      addresses: [],
      replyFrom: userA,
      incoming: 'keep',
      incomingAddress: null,
    }
    const putRes = await a.request('/api/filters/vacation', { method: 'PUT', body: vacation })
    expect(putRes.status).toBe(200)

    await deliverByLmtp(userA, userB, 'Bonjour', 'Message de test pour déclencher la réponse automatique.')

    const b = await login(userB)
    const reply = await waitForSubject(b, 'INBOX', 'Absent(e)')
    expect(reply.from?.address).toBe(userA)
  }, 30_000)
})
