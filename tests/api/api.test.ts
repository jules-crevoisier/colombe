/**
 * Tests de l'API sur un vrai serveur Nuxt construit, backend mémoire.
 * Chaque test repart du jeu de données initial (POST /api/__mock/reset).
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { Folder, MessageDetail, MessagePage } from '#shared/types/mail'

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

async function login(email = 'dev@mmi-troyes.fr', password = email.startsWith('dev') ? 'dev-password' : 'alice-password'): Promise<Client> {
  const c = client()
  const res = await c.request('/api/auth/login', { method: 'POST', body: { email, password } })
  expect(res.status).toBe(200)
  return c
}

async function findBySubject(c: Client, folder: string, subject: string) {
  const page = await c.json<MessagePage>(`/api/messages?folder=${encodeURIComponent(folder)}&pageSize=100`)
  return page.items.find(m => m.subject === subject)
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('auth', () => {
  it('should log in and expose only the email in the session', async () => {
    const c = await login()
    const session = await c.json<Record<string, unknown>>('/api/_auth/session')
    expect(session.user).toEqual({ email: 'dev@mmi-troyes.fr' })
    expect(JSON.stringify(session)).not.toContain('dev-password')
    expect(c.cookie).not.toContain('dev-password')
  })

  it('should normalise the email address', async () => {
    const res = await client().request('/api/auth/login', { method: 'POST', body: { email: '  DEV@mmi-troyes.fr ', password: 'dev-password' } })
    expect(res.status).toBe(200)
  })

  it('should reject a wrong password with 401 and a foreign domain with 403', async () => {
    expect((await client().request('/api/auth/login', { method: 'POST', body: { email: 'alice@mmi-troyes.fr', password: 'x' } })).status).toBe(401)
    expect((await client().request('/api/auth/login', { method: 'POST', body: { email: 'bob@gmail.com', password: 'x' } })).status).toBe(403)
  })

  it('should rate-limit after 5 failures for the same address, even with the right password', async () => {
    const email = 'ratelimit@mmi-troyes.fr'
    for (let i = 0; i < 5; i++) {
      expect((await client().request('/api/auth/login', { method: 'POST', body: { email, password: 'bad' } })).status).toBe(401)
    }
    expect((await client().request('/api/auth/login', { method: 'POST', body: { email, password: 'bad' } })).status).toBe(429)
  })

  it('should return 401 without a session and after logout', async () => {
    expect((await client().request('/api/folders')).status).toBe(401)
    const c = await login()
    expect((await c.request('/api/auth/logout', { method: 'POST' })).status).toBe(204)
    expect((await c.request('/api/folders')).status).toBe(401)
  })

  it('should refuse a mutating request without a same-origin Origin header', async () => {
    const c = await login()
    const noOrigin = await fetch(url('/api/messages/flags'), {
      method: 'POST',
      headers: { 'cookie': c.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'INBOX', uids: [1], seen: true }),
    })
    expect(noOrigin.status).toBe(403)
    const foreign = await c.request('/api/messages/flags', { method: 'POST', body: { folder: 'INBOX', uids: [1], seen: true }, headers: { origin: 'https://evil.example' } })
    expect(foreign.status).toBe(403)
  })
})

describe('folders and messages', () => {
  it('should list folders in Gmail order with counts', async () => {
    const folders = await (await login()).json<Folder[]>('/api/folders')
    expect(folders.map(f => f.specialUse)).toEqual(['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', null])
    expect(folders[0]).toMatchObject({ path: 'INBOX', name: 'Boîte de réception' })
    expect(folders[0]!.total).toBe(67)
    expect(folders[0]!.unread).toBeGreaterThan(0)
  })

  it('should paginate newest first', async () => {
    const c = await login()
    const p1 = await c.json<MessagePage>('/api/messages?folder=INBOX&page=1&pageSize=50')
    const p2 = await c.json<MessagePage>('/api/messages?folder=INBOX&page=2&pageSize=50')
    expect(p1).toMatchObject({ total: 67, page: 1, pageSize: 50 })
    expect(p1.items).toHaveLength(50)
    expect(p2.items).toHaveLength(17)
    const dates = [...p1.items, ...p2.items].map(m => Date.parse(m.date))
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
    expect(p1.items[0]!.subject).toBe('La lettre du département — septembre')
  })

  it('should reject pageSize above 100 and an empty folder name', async () => {
    const c = await login()
    expect((await c.request('/api/messages?folder=INBOX&pageSize=500')).status).toBe(400)
    expect((await c.request('/api/messages?folder=')).status).toBe(400)
  })

  it('should search', async () => {
    const page = await (await login()).json<MessagePage>(`/api/messages?folder=INBOX&q=${encodeURIComponent('relevé de notes')}`)
    expect(page.items.map(m => m.subject)).toEqual(['Relevé de notes — semestre 4'])
  })

  it('should return 404 for an unknown folder or uid', async () => {
    const c = await login()
    expect((await c.request('/api/messages?folder=Nope')).status).toBe(404)
    expect((await c.request('/api/messages/99999?folder=INBOX')).status).toBe(404)
  })

  it('should return a sanitised detail and mark it as seen', async () => {
    const c = await login()
    const trap = await findBySubject(c, 'INBOX', 'Facture impayée — action requise')
    expect(trap?.seen).toBe(false)
    const detail = await c.json<MessageDetail>(`/api/messages/${trap!.uid}?folder=INBOX`)
    for (const bad of ['<script', 'onerror', 'javascript:', '<iframe', '<form', '<meta', 'evil.example']) {
      expect(detail.html).not.toContain(bad)
    }
    expect(detail.seen).toBe(true)
    expect((await findBySubject(c, 'INBOX', 'Facture impayée — action requise'))?.seen).toBe(true)
  })

  it('should block remote images by default and inline cid images', async () => {
    const c = await login()
    const news = await findBySubject(c, 'INBOX', 'La lettre du département — septembre')
    const detail = await c.json<MessageDetail>(`/api/messages/${news!.uid}?folder=INBOX`)
    expect(detail.remoteImages).toBe(4)
    expect(detail.html).not.toMatch(/\ssrc="https?:/)
    const logo = await findBySubject(c, 'INBOX', 'Maquette avec logo intégré')
    const withLogo = await c.json<MessageDetail>(`/api/messages/${logo!.uid}?folder=INBOX`)
    expect(withLogo.html).toContain('src="data:image/png;base64,')
    expect(withLogo.attachments).toEqual([])
  })

  it('should serve attachments as downloads only', async () => {
    const c = await login()
    const msg = await findBySubject(c, 'INBOX', 'Relevé de notes — semestre 4')
    const detail = await c.json<MessageDetail>(`/api/messages/${msg!.uid}?folder=INBOX`)
    expect(detail.flagged).toBe(true)
    expect(detail.attachments).toEqual([expect.objectContaining({ id: '0', filename: 'releve-notes-S4.pdf' })])
    const res = await c.request(`/api/messages/${msg!.uid}/attachments/0?folder=INBOX`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect((await c.request(`/api/messages/${msg!.uid}/attachments/5?folder=INBOX`)).status).toBe(404)
  })

  it('should update flags, move, and delete via the trash', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    expect((await c.request('/api/messages/flags', { method: 'POST', body: { folder: 'INBOX', uids: [msg.uid], flagged: true } })).status).toBe(204)
    expect((await c.request('/api/messages/flags', { method: 'POST', body: { folder: 'INBOX', uids: [msg.uid] } })).status).toBe(400)

    expect((await c.request('/api/messages/move', { method: 'POST', body: { folder: 'INBOX', uids: [msg.uid], destination: 'INBOX.Archives' } })).status).toBe(204)
    const archived = await findBySubject(c, 'INBOX.Archives', msg.subject)
    expect(archived?.flagged).toBe(true)

    expect((await c.request('/api/messages/delete', { method: 'POST', body: { folder: 'INBOX.Archives', uids: [archived!.uid] } })).status).toBe(204)
    const trashed = await findBySubject(c, 'INBOX.Corbeille', msg.subject)
    expect(trashed).toBeDefined()
    expect((await c.request('/api/messages/delete', { method: 'POST', body: { folder: 'INBOX.Corbeille', uids: [trashed!.uid] } })).status).toBe(204)
    expect(await findBySubject(c, 'INBOX.Corbeille', msg.subject)).toBeUndefined()
  })
})

describe('compose', () => {
  it('should send to alice, keep Bcc only in the sender copy', async () => {
    const dev = await login()
    const subject = `Test envoi ${Date.now()}`
    const res = await dev.request('/api/send', {
      method: 'POST',
      body: { to: ['alice@mmi-troyes.fr'], cc: [], bcc: ['secret@mmi-troyes.fr'], subject, text: 'Bonjour Alice' },
    })
    expect(res.status).toBe(204)

    const sent = await findBySubject(dev, 'INBOX.Envoyés', subject)
    expect(sent).toBeDefined()
    const sentDetail = await dev.json<MessageDetail>(`/api/messages/${sent!.uid}?folder=${encodeURIComponent('INBOX.Envoyés')}`)
    expect(sentDetail.bcc.map(a => a.address)).toEqual(['secret@mmi-troyes.fr'])

    const alice = await login('alice@mmi-troyes.fr')
    const received = await findBySubject(alice, 'INBOX', subject)
    expect(received?.seen).toBe(false)
    const receivedDetail = await alice.json<MessageDetail>(`/api/messages/${received!.uid}?folder=INBOX`)
    expect(receivedDetail.bcc).toEqual([])
    expect(receivedDetail.from?.address).toBe('dev@mmi-troyes.fr')
  })

  it('should validate the payload', async () => {
    const dev = await login()
    const send = (body: Record<string, unknown>) => dev.request('/api/send', { method: 'POST', body: { to: [], cc: [], bcc: [], subject: 's', text: 't', ...body } })
    expect((await send({})).status).toBe(400)
    expect((await send({ to: ['pas-une-adresse'] })).status).toBe(400)
    expect((await send({ to: ['alice@mmi-troyes.fr'], subject: 'a\r\nBcc: x@evil.example' })).status).toBe(400)
  })

  it('should save a draft, replace it, then delete it when sent', async () => {
    const dev = await login()
    const draft = { to: ['alice@mmi-troyes.fr'], cc: [], bcc: [], subject: 'Brouillon test', text: 'v1' }
    const first = await dev.request('/api/drafts', { method: 'POST', body: draft })
    const { uid: uid1 } = (await first.json()) as { uid: number }
    const second = await dev.request('/api/drafts', { method: 'POST', body: { ...draft, text: 'v2', draftUid: uid1 } })
    const { uid: uid2 } = (await second.json()) as { uid: number }
    expect(uid2).not.toBe(uid1)

    const drafts = await dev.json<MessagePage>(`/api/messages?folder=${encodeURIComponent('INBOX.Brouillons')}`)
    expect(drafts.items.filter(m => m.subject === 'Brouillon test').map(m => m.uid)).toEqual([uid2])

    expect((await dev.request('/api/send', { method: 'POST', body: { ...draft, text: 'final', draftUid: uid2 } })).status).toBe(204)
    expect(await findBySubject(dev, 'INBOX.Brouillons', 'Brouillon test')).toBeUndefined()
  })
})
