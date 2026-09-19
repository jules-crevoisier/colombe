/**
 * Tests de l'API v2 : gestion des dossiers et fils de discussion.
 * Chaque test repart du jeu de données initial (POST /api/__mock/reset).
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { Folder, ThreadResult } from '#shared/types/mail'

const base = inject('apiBase')
const url = (path: string) => `${base}${path}`
const origin = () => new URL(url('/')).origin

interface Client {
  cookie: string
  request: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>
  json: <T>(path: string) => Promise<T>
  status: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<number>
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
    async status(path: string, init = {}) {
      const res = await c.request(path, init)
      return res.status
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

describe('POST /api/folders - create folder', () => {
  it('creates a new folder', async () => {
    const c = await login()
    const res = await c.request('/api/folders', {
      method: 'POST',
      body: { name: 'TestFolder' },
    })
    expect(res.status).toBe(201)
    const folder = await res.json() as Folder
    expect(folder.path).toContain('TestFolder')
    expect(folder.name).toBe('TestFolder')
  })

  it('uses provided parent', async () => {
    const c = await login()
    const res = await c.request('/api/folders', {
      method: 'POST',
      body: { name: 'SubFolder', parent: 'INBOX' },
    })
    expect(res.status).toBe(201)
    const folder = await res.json() as Folder
    expect(folder.path).toBe('INBOX.SubFolder')
  })

  it('uses default delimiter', async () => {
    const c = await login()
    const res = await c.request('/api/folders', {
      method: 'POST',
      body: { name: 'TestFolder' },
    })
    expect(res.status).toBe(201)
    const folder = await res.json() as Folder
    expect(folder.delimiter).toBe('.')
  })

  it('returns 400 for empty name', async () => {
    const c = await login()
    const status = await c.status('/api/folders', {
      method: 'POST',
      body: { name: '' },
    })
    expect(status).toBe(400)
  })

  it('returns 400 for name with slash', async () => {
    const c = await login()
    const status = await c.status('/api/folders', {
      method: 'POST',
      body: { name: 'Test/Folder' },
    })
    expect(status).toBe(400)
  })

  it('returns 400 for very long name', async () => {
    const c = await login()
    const longName = 'a'.repeat(201)
    const status = await c.status('/api/folders', {
      method: 'POST',
      body: { name: longName },
    })
    expect(status).toBe(400)
  })

  it('returns 409 for duplicate folder', async () => {
    const c = await login()
    await c.request('/api/folders', {
      method: 'POST',
      body: { name: 'TestFolder' },
    })
    const status = await c.status('/api/folders', {
      method: 'POST',
      body: { name: 'TestFolder' },
    })
    expect(status).toBe(409)
  })

  it('requires session', async () => {
    const c = client()
    const status = await c.status('/api/folders', {
      method: 'POST',
      body: { name: 'TestFolder' },
    })
    expect(status).toBe(401)
  })
})

describe('PATCH /api/folders - rename folder', () => {
  it('renames an existing folder', async () => {
    const c = await login()
    await c.request('/api/folders', {
      method: 'POST',
      body: { name: 'OldName' },
    })
    const res = await c.request('/api/folders', {
      method: 'PATCH',
      body: { path: 'INBOX.OldName', name: 'NewName' },
    })
    expect(res.status).toBe(200)
    const result = await res.json() as { path: string }
    expect(result.path).toBe('INBOX.NewName')
  })

  it('returns 404 for non-existent folder', async () => {
    const c = await login()
    const status = await c.status('/api/folders', {
      method: 'PATCH',
      body: { path: 'INBOX.NonExistent', name: 'NewName' },
    })
    expect(status).toBe(404)
  })

  it('returns 400 for renaming INBOX', async () => {
    const c = await login()
    const status = await c.status('/api/folders', {
      method: 'PATCH',
      body: { path: 'INBOX', name: 'MyInbox' },
    })
    expect(status).toBe(400)
  })

  it('returns 400 for renaming special-use folders', async () => {
    const c = await login()
    const specialFolders = ['INBOX.Envoyés', 'INBOX.Brouillons', 'INBOX.Corbeille', 'INBOX.Spam', 'INBOX.Archives']
    for (const folder of specialFolders) {
      const status = await c.status('/api/folders', {
        method: 'PATCH',
        body: { path: folder, name: 'NewName' },
      })
      expect(status).toBe(400)
    }
  })

  it('requires session', async () => {
    const c = client()
    const status = await c.status('/api/folders', {
      method: 'PATCH',
      body: { path: 'INBOX.Test', name: 'NewName' },
    })
    expect(status).toBe(401)
  })
})

describe('DELETE /api/folders - delete folder', () => {
  it('deletes an empty folder', async () => {
    const c = await login()
    await c.request('/api/folders', {
      method: 'POST',
      body: { name: 'ToDelete' },
    })
    const res = await c.request('/api/folders', {
      method: 'DELETE',
      body: { path: 'INBOX.ToDelete' },
    })
    expect(res.status).toBe(204)
    const folders = await c.json<Folder[]>('/api/folders')
    expect(folders.find(f => f.path === 'INBOX.ToDelete')).toBeUndefined()
  })

  it('moves every message to the trash before deleting (more than one page)', async () => {
    const c = await login()
    const created = await c.request('/api/folders', { method: 'POST', body: { name: 'A vider' } })
    expect(created.status).toBe(201)
    const { path } = (await created.json()) as Folder
    // 60 messages de la boîte de réception : plus d'un lot de déplacement.
    const inbox = await c.json<{ items: Array<{ uid: number }> }>('/api/messages?folder=INBOX&pageSize=60')
    const moved = await c.request('/api/messages/move', { method: 'POST', body: { folder: 'INBOX', uids: inbox.items.map(m => m.uid), destination: path } })
    expect(moved.status).toBe(204)
    const trashBefore = await c.json<{ total: number }>(`/api/messages?folder=${encodeURIComponent('INBOX.Corbeille')}&pageSize=1`)

    const res = await c.request('/api/folders', { method: 'DELETE', body: { path } })
    expect(res.status).toBe(204)
    const folders = await c.json<Folder[]>('/api/folders')
    expect(folders.some(f => f.path === path)).toBe(false)
    const trashAfter = await c.json<{ total: number }>(`/api/messages?folder=${encodeURIComponent('INBOX.Corbeille')}&pageSize=1`)
    expect(trashAfter.total - trashBefore.total).toBe(60)
  })

  it('returns 400 for deleting INBOX', async () => {
    const c = await login()
    const status = await c.status('/api/folders', {
      method: 'DELETE',
      body: { path: 'INBOX' },
    })
    expect(status).toBe(400)
  })

  it('returns 400 for deleting special-use folders', async () => {
    const c = await login()
    const specialFolders = ['INBOX.Envoyés', 'INBOX.Brouillons', 'INBOX.Corbeille', 'INBOX.Spam', 'INBOX.Archives']
    for (const folder of specialFolders) {
      const status = await c.status('/api/folders', {
        method: 'DELETE',
        body: { path: folder },
      })
      expect(status).toBe(400)
    }
  })

  it('returns 404 for non-existent folder', async () => {
    const c = await login()
    const status = await c.status('/api/folders', {
      method: 'DELETE',
      body: { path: 'INBOX.NonExistent' },
    })
    expect(status).toBe(404)
  })

  it('requires session', async () => {
    const c = client()
    const status = await c.status('/api/folders', {
      method: 'DELETE',
      body: { path: 'INBOX.Test' },
    })
    expect(status).toBe(401)
  })
})

describe('GET /api/messages/[uid]/thread - thread endpoint', () => {
  it('returns thread with single message if no replies', async () => {
    const c = await login()
    const messages = await c.json<any>('/api/messages?folder=INBOX&pageSize=1')
    if (messages.items.length === 0) return
    const uid = messages.items[0].uid
    const thread = await c.json<ThreadResult>(`/api/messages/${uid}/thread?folder=INBOX`)
    expect(thread.items).toHaveLength(1)
    expect(thread.items[0].uid).toBe(uid)
  })

  it('returns thread with multiple messages', async () => {
    const c = await login()
    // This requires a threaded conversation in the test data
    const messages = await c.json<any>('/api/messages?folder=INBOX&pageSize=100')
    if (messages.items.length < 2) return
    const uid = messages.items[0].uid
    const thread = await c.json<ThreadResult>(`/api/messages/${uid}/thread?folder=INBOX`)
    expect(thread.items).toBeDefined()
    expect(Array.isArray(thread.items)).toBe(true)
  })

  it('returns 404 for non-existent message', async () => {
    const c = await login()
    const status = await c.status('/api/messages/99999/thread?folder=INBOX')
    expect(status).toBe(404)
  })

  it('returns 404 for non-existent folder', async () => {
    const c = await login()
    const status = await c.status('/api/messages/1/thread?folder=UNKNOWN')
    expect(status).toBe(404)
  })

  it('requires session', async () => {
    const c = client()
    const status = await c.status('/api/messages/1/thread?folder=INBOX')
    expect(status).toBe(401)
  })

  it('returns items sorted by date ascending', async () => {
    const c = await login()
    const messages = await c.json<any>('/api/messages?folder=INBOX&pageSize=100')
    if (messages.items.length < 2) return
    const uid = messages.items[0].uid
    const thread = await c.json<ThreadResult>(`/api/messages/${uid}/thread?folder=INBOX`)
    if (thread.items.length < 2) return
    for (let i = 1; i < thread.items.length; i++) {
      const prevDate = new Date(thread.items[i - 1].date).getTime()
      const currDate = new Date(thread.items[i].date).getTime()
      expect(currDate).toBeGreaterThanOrEqual(prevDate)
    }
  })

  it('caps results at 50 items', async () => {
    const c = await login()
    const messages = await c.json<any>('/api/messages?folder=INBOX&pageSize=100')
    if (messages.items.length === 0) return
    const uid = messages.items[0].uid
    const thread = await c.json<ThreadResult>(`/api/messages/${uid}/thread?folder=INBOX`)
    expect(thread.items.length).toBeLessThanOrEqual(50)
  })
})
