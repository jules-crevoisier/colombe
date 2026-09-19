/**
 * Tests de l'API SSE sur un serveur Nuxt construit, backend mémoire.
 * Vérifie que les événements sont poussés aux clients connectés.
 */
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'

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

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('GET /api/events (SSE)', () => {
  it('should reject without a session (401)', async () => {
    const res = await client().request('/api/events')
    expect(res.status).toBe(401)
  })

  it('should return a text/event-stream with authenticated session', async () => {
    const c = await login()
    const res = await c.request('/api/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })

  it('should send ping every 25s', async () => {
    const c = await login()
    const res = await c.request('/api/events')
    expect(res.status).toBe(200)

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No body reader')

    const decoder = new TextDecoder()
    let data = ''
    let pings = 0

    // Read for up to 30 seconds
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && pings < 1) {
      const { done, value } = await reader.read()
      if (done) break

      data += decoder.decode(value, { stream: true })

      // Count ping events
      const lines = data.split('\n')
      for (const line of lines) {
        if (line.includes('type":"ping"')) {
          pings++
        }
      }
    }

    reader.releaseLock()
    expect(pings).toBeGreaterThan(0)
  })

  it('should push mailbox events when a message is sent', async () => {
    const dev = await login('dev@universite.example', 'dev-password')
    const alice = await login('alice@universite.example', 'alice-password')

    // Open event stream for dev
    const devEvents = await dev.request('/api/events')
    expect(devEvents.status).toBe(200)

    const reader = devEvents.body?.getReader()
    if (!reader) throw new Error('No body reader')

    const decoder = new TextDecoder()
    let streamData = ''
    const deadline = Date.now() + 5_000

    // Send a message from alice to dev
    const sendRes = await alice.request('/api/send', {
      method: 'POST',
      body: {
        to: ['dev@universite.example'],
        cc: [],
        bcc: [],
        subject: 'Test event',
        text: 'Test body',
      },
    })
    expect(sendRes.status).toBe(204)

    // Lecture du flux jusqu'à l'événement attendu. Une seule lecture en cours à la
    // fois : une lecture abandonnée sur délai perdrait son morceau de flux.
    let gotEvent = false
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null
    while (Date.now() < deadline && !gotEvent) {
      pending ??= reader.read()
      const result = await Promise.race([
        pending,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 250)),
      ])
      if (result === null) continue
      pending = null
      if (result.done) break
      streamData += decoder.decode(result.value, { stream: true })
      gotEvent = streamData.includes('"type":"mailbox"') && streamData.includes('"folder":"INBOX"')
    }

    await reader.cancel()
    expect(gotEvent).toBe(true)
  })
})
