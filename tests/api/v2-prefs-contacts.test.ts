/**
 * Tests for v2 API: prefs and contacts management
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { Contact, Prefs } from '#shared/types/mail'

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

async function login(email = 'dev@mmi-troyes.fr', password = 'dev-password'): Promise<Client> {
  const c = client()
  const res = await c.request('/api/auth/login', { method: 'POST', body: { email, password } })
  expect(res.status).toBe(200)
  return c
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('prefs API', () => {
  it('should return DEFAULT_PREFS on first request', async () => {
    const c = await login()
    const prefs = await c.json<Prefs>('/api/prefs')
    expect(prefs).toMatchObject({
      signatureEnabled: false,
      pageSize: 50,
      density: 'comfortable',
      undoSendSeconds: 5,
      conversationView: true,
      desktopNotifications: false,
    })
  })

  it('should require authentication', async () => {
    const c = client()
    const res = await c.request('/api/prefs')
    expect(res.status).toBe(401)
  })

  it('should save and retrieve partial prefs updates', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', {
      method: 'PUT',
      body: { pageSize: 100, density: 'compact' },
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as Prefs
    expect(updated.pageSize).toBe(100)
    expect(updated.density).toBe('compact')
    expect(updated.undoSendSeconds).toBe(5)

    const fetched = await c.json<Prefs>('/api/prefs')
    expect(fetched.pageSize).toBe(100)
    expect(fetched.density).toBe('compact')
  })

  it('should validate pageSize on PUT', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', {
      method: 'PUT',
      body: { pageSize: 75 },
    })
    expect(res.status).toBe(400)
  })

  it('should validate density on PUT', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', {
      method: 'PUT',
      body: { density: 'cozy' },
    })
    expect(res.status).toBe(400)
  })

  it('should sanitize signatureHtml and reject scripts', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', {
      method: 'PUT',
      body: { signatureHtml: '<p>My sig <script>alert("xss")</script></p>' },
    })
    expect(res.status).toBe(200)
    const prefs = (await res.json()) as Prefs
    expect(prefs.signatureHtml).not.toContain('<script>')
    expect(prefs.signatureHtml).toContain('My sig')
  })

  it('should enforce signatureHtml max 10000 chars', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', {
      method: 'PUT',
      body: { signatureHtml: 'a'.repeat(10001) },
    })
    expect(res.status).toBe(400)
  })

  it('should update multiple fields at once', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', {
      method: 'PUT',
      body: {
        pageSize: 25,
        density: 'compact',
        undoSendSeconds: 20,
        signatureEnabled: true,
      },
    })
    expect(res.status).toBe(200)
    const prefs = (await res.json()) as Prefs
    expect(prefs.pageSize).toBe(25)
    expect(prefs.density).toBe('compact')
    expect(prefs.undoSendSeconds).toBe(20)
    expect(prefs.signatureEnabled).toBe(true)
  })

  it('should isolate prefs by user', async () => {
    const dev = await login()
    await dev.request('/api/prefs', {
      method: 'PUT',
      body: { pageSize: 100 },
    })
    const alice = await login('alice@mmi-troyes.fr', 'alice-password')
    const alicePrefs = await alice.json<Prefs>('/api/prefs')
    expect(alicePrefs.pageSize).toBe(50)
  })
})

describe('contacts API', () => {
  it('should list empty contacts initially', async () => {
    const c = await login()
    const contacts = await c.json<Contact[]>('/api/contacts')
    expect(contacts).toEqual([])
  })

  it('should require authentication for list', async () => {
    const c = client()
    const res = await c.request('/api/contacts')
    expect(res.status).toBe(401)
  })

  it('should create a manual contact', async () => {
    const c = await login()
    const res = await c.request('/api/contacts', {
      method: 'POST',
      body: { email: 'bob@example.com', name: 'Bob' },
    })
    expect(res.status).toBe(201)
    const contact = (await res.json()) as Contact
    expect(contact.email).toBe('bob@example.com')
    expect(contact.name).toBe('Bob')
    expect(contact.manual).toBe(true)
  })

  it('should validate email on POST', async () => {
    const c = await login()
    const res = await c.request('/api/contacts', {
      method: 'POST',
      body: { email: 'invalid', name: 'Name' },
    })
    expect(res.status).toBe(400)
  })

  it('should validate name max length on POST', async () => {
    const c = await login()
    const res = await c.request('/api/contacts', {
      method: 'POST',
      body: { email: 'bob@example.com', name: 'a'.repeat(201) },
    })
    expect(res.status).toBe(400)
  })

  it('should support search by email prefix', async () => {
    const c = await login()
    await c.request('/api/contacts', {
      method: 'POST',
      body: { email: 'bob@example.com', name: 'Bob' },
    })
    await c.request('/api/contacts', {
      method: 'POST',
      body: { email: 'charlie@example.com', name: 'Charlie' },
    })
    const results = await c.json<Contact[]>('/api/contacts?q=bo')
    expect(results).toHaveLength(1)
    expect(results[0].email).toBe('bob@example.com')
  })

  it('should support search with limit parameter', async () => {
    const c = await login()
    for (let i = 0; i < 30; i++) {
      await c.request('/api/contacts', {
        method: 'POST',
        body: { email: `user${i}@example.com`, name: `User ${i}` },
      })
    }
    const results = await c.json<Contact[]>('/api/contacts?limit=10')
    expect(results.length).toBeLessThanOrEqual(10)
  })

  it('should limit to 50 max for limit parameter', async () => {
    const c = await login()
    const res = await c.request('/api/contacts?limit=100')
    expect(res.status).toBe(400)
  })

  it('should update contact name', async () => {
    const c = await login()
    const created = (await (await c.request('/api/contacts', { method: 'POST', body: { email: 'bob@example.com', name: 'Bob' } })).json()) as Contact
    const res = await c.request(`/api/contacts/${created.id}`, {
      method: 'PATCH',
      body: { name: 'Robert' },
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as Contact
    expect(updated.name).toBe('Robert')
  })

  it('should return 404 on PATCH non-existent contact', async () => {
    const c = await login()
    const res = await c.request('/api/contacts/999', {
      method: 'PATCH',
      body: { name: 'Test' },
    })
    expect(res.status).toBe(404)
  })

  it('should not allow PATCHing another user\'s contact', async () => {
    const dev = await login()
    const contact = (await (await dev.request('/api/contacts', { method: 'POST', body: { email: 'bob@example.com', name: 'Bob' } })).json()) as Contact
    const alice = await login('alice@mmi-troyes.fr', 'alice-password')
    const res = await alice.request(`/api/contacts/${contact.id}`, {
      method: 'PATCH',
      body: { name: 'Hacked' },
    })
    expect(res.status).toBe(404)
  })

  it('should delete a contact', async () => {
    const c = await login()
    const contact = (await (await c.request('/api/contacts', { method: 'POST', body: { email: 'bob@example.com', name: 'Bob' } })).json()) as Contact
    const res = await c.request(`/api/contacts/${contact.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    const list = await c.json<Contact[]>('/api/contacts')
    expect(list).toHaveLength(0)
  })

  it('should return 404 on DELETE non-existent contact', async () => {
    const c = await login()
    const res = await c.request('/api/contacts/999', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('should not allow DELETing another user\'s contact', async () => {
    const dev = await login()
    const contact = (await (await dev.request('/api/contacts', { method: 'POST', body: { email: 'bob@example.com', name: 'Bob' } })).json()) as Contact
    const alice = await login('alice@mmi-troyes.fr', 'alice-password')
    const res = await alice.request(`/api/contacts/${contact.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

describe('contacts auto-collection on send', () => {
  it('should add recipient to contacts on successful send', async () => {
    const dev = await login()
    const subject = `Auto-collect ${Date.now()}`
    await dev.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: ['bob@example.com'],
        bcc: ['secret@example.com'],
        subject,
        text: 'Test',
      },
    })
    const contacts = await dev.json<Contact[]>('/api/contacts')
    const alice = contacts.find(c => c.email === 'alice@mmi-troyes.fr')
    expect(alice).toBeDefined()
    expect(alice?.manual).toBe(false)
    expect(alice?.timesContacted).toBe(1)
    // Le carnet du destinataire n'est pas modifié.
    const aliceClient = await login('alice@mmi-troyes.fr', 'alice-password')
    expect(await aliceClient.json<Contact[]>('/api/contacts')).toEqual([])
  })

  it('should collect from to, cc, and bcc recipients', async () => {
    const dev = await login()
    await dev.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: ['bob@example.com'],
        bcc: ['secret@example.com'],
        subject: 'Multi recipient',
        text: 'Test',
      },
    })
    const dev_contacts = await dev.json<Contact[]>('/api/contacts')
    expect(dev_contacts.length).toBeGreaterThan(0)
  })

  it('should not collect the sender\'s own address', async () => {
    const dev = await login()
    await dev.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: ['dev@mmi-troyes.fr'],
        bcc: [],
        subject: 'Self recipient',
        text: 'Test',
      },
    })
    const contacts = await dev.json<Contact[]>('/api/contacts?q=dev')
    expect(contacts).toEqual([])
  })

  it('should increment times_contacted on multiple sends to same address', async () => {
    const dev = await login()
    for (let i = 0; i < 3; i++) {
      await dev.request('/api/send', {
        method: 'POST',
        body: {
          to: ['alice@mmi-troyes.fr'],
          cc: [],
          bcc: [],
          subject: `Message ${i}`,
          text: 'Test',
        },
      })
    }
    const contacts = await dev.json<Contact[]>('/api/contacts?q=alice')
    expect(contacts).toHaveLength(1)
    expect(contacts[0]?.timesContacted).toBe(3)
  })
})
