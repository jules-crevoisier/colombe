/**
 * Page d'état du serveur mail : réservée aux adresses de COLOMBE_ADMIN_EMAILS
 * (dev@universite.example dans global-setup), lit tests/fixtures/etat-serveur.json.
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { AdminAccess, ServerStatusResponse } from '#shared/types/server-status'

const base = inject('apiBase')
const url = (path: string) => `${base}${path}`
const origin = () => new URL(url('/')).origin

interface Client {
  cookie: string
  request: (path: string) => Promise<Response>
}

function client(): Client {
  const c: Client = {
    cookie: '',
    async request(path) {
      const headers: Record<string, string> = {}
      if (c.cookie) headers.cookie = c.cookie
      const res = await fetch(url(path), { headers, redirect: 'manual' })
      return res
    },
  }
  return c
}

async function login(email: string, password: string): Promise<Client> {
  const c = client()
  const res = await fetch(url('/api/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin() },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  })
  expect(res.status).toBe(200)
  const setCookie = res.headers.getSetCookie().find(v => v.startsWith('wm_session='))
  c.cookie = setCookie?.split(';')[0] ?? ''
  return c
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

describe('état du serveur mail', () => {
  it('sans session : 401', async () => {
    expect((await client().request('/api/admin/access')).status).toBe(401)
    expect((await client().request('/api/admin/server-status')).status).toBe(401)
  })

  it('utilisateur ordinaire : aucun accès, 403 sur l\'état', async () => {
    const alice = await login('alice@universite.example', 'alice-password')
    const access = await alice.request('/api/admin/access')
    expect(access.status).toBe(200)
    expect(await access.json() as AdminAccess).toEqual({ serverStatus: false })

    const status = await alice.request('/api/admin/server-status')
    expect(status.status).toBe(403)
    const body = await status.text()
    expect(body).not.toContain('postfix')
    expect(body).not.toContain('stack')
  })

  it('administrateur : accès et état complet, jamais mis en cache', async () => {
    const dev = await login('dev@universite.example', 'dev-password')
    const access = await dev.request('/api/admin/access')
    expect(await access.json() as AdminAccess).toEqual({ serverStatus: true })

    const res = await dev.request('/api/admin/server-status')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json() as ServerStatusResponse
    expect(body.available).toBe(true)
    if (!body.available) return
    expect(body.status.global).toBe('attention')
    expect(body.status.services.map(s => s.nom)).toContain('Postfix')
    expect(body.status.comptes?.bloques).toBe(336)
  })
})
