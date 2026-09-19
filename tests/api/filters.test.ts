/**
 * Tests boîte noire pour la vague F : filtres Sieve, réponse automatique, transfert.
 * Voir docs/dev/PLAN-v4.md section F (contrat, types, API) et docs/dev/ROADMAP.md section F
 * (contexte de sécurité). Contre le faux serveur ManageSieve en mémoire
 * (MAIL_BACKEND=mock) : capacités fileinto, vacation, copy, imap4flags, date,
 * relational, body, reject, editheader, variables, enotify.
 * Chaque test repart du jeu de données initial (POST /api/__mock/reset).
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type {
  FilterRule,
  FilterSet,
  FiltersStatus,
  ForwardSettings,
  MessagePage,
  VacationSettings,
} from '#shared/types/mail'

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

async function message(res: Response): Promise<string> {
  const body = (await res.json()) as { message: string }
  return body.message
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

const MOVE_RULE: FilterRule = {
  id: 'r-mmi',
  name: 'Objet MMI vers Projets',
  enabled: true,
  match: 'all',
  conditions: [{ field: 'subject', op: 'contains', value: '[MMI]' }],
  actions: [{ type: 'move', folder: 'INBOX.Projets' }],
}

const FORBIDDEN_DOMAIN_MESSAGE = 'Transfert interdit vers ce domaine.'
const CONFIRM_PASSWORD_MESSAGE = 'Confirmez votre mot de passe.'

// ============================================================================
// GET /api/filters — disponibilité, capacités, ensembles
// ============================================================================

describe('GET /api/filters', () => {
  it('should report availability, sieve capabilities, and the (empty) set list', async () => {
    const c = await login()
    const status = await c.json<FiltersStatus>('/api/filters')
    expect(status.available).toBe(true)
    expect(status.capabilities.slice().sort()).toEqual(
      ['body', 'copy', 'date', 'editheader', 'enotify', 'fileinto', 'imap4flags', 'reject', 'relational', 'variables', 'vacation'].sort(),
    )
    expect(Array.isArray(status.sets)).toBe(true)
  })
})

// ============================================================================
// Ensembles : création, règles, script généré, activation, suppression
// ============================================================================

describe('POST /api/filters/sets — create a set', () => {
  it('should create a managed set with no rules yet', async () => {
    const c = await login()
    const res = await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    expect(res.status).toBe(201)

    const set = await c.json<FilterSet>('/api/filters/sets/perso')
    expect(set.managed).toBe(true)
    expect(set.rules).toEqual([])
  })
})

describe('PUT /api/filters/sets/{name} — rules round-trip and generated script', () => {
  it('should round-trip rules exactly and generate a script with require + fileinto for a move rule', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })

    const putRes = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [MOVE_RULE] } })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as FilterSet
    expect(putBody.script).toContain('require')
    expect(putBody.script).toContain('fileinto')

    const fetched = await c.json<FilterSet>('/api/filters/sets/perso')
    expect(fetched.rules).toEqual([MOVE_RULE])
    expect(fetched.script).toContain('fileinto')
  })
})

describe('activation / désactivation d\'un ensemble', () => {
  it('should mark a set active in GET /api/filters, then deactivate all sets', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })

    const activateRes = await c.request('/api/filters/sets/perso/activate', { method: 'POST' })
    expect(activateRes.status).toBe(204)

    let status = await c.json<FiltersStatus>('/api/filters')
    expect(status.sets.find(s => s.name === 'perso')?.active).toBe(true)

    const deactivateRes = await c.request('/api/filters/deactivate', { method: 'POST' })
    expect(deactivateRes.status).toBe(204)

    status = await c.json<FiltersStatus>('/api/filters')
    expect(status.sets.length).toBeGreaterThan(0)
    expect(status.sets.every(s => !s.active)).toBe(true)
  })
})

describe('DELETE /api/filters/sets/{name}', () => {
  it('should refuse deleting the active set with 409', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    await c.request('/api/filters/sets/perso/activate', { method: 'POST' })

    const res = await c.request('/api/filters/sets/perso', { method: 'DELETE' })
    expect(res.status).toBe(409)
  })

  it('should allow deleting an inactive set', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })

    const res = await c.request('/api/filters/sets/perso', { method: 'DELETE' })
    expect(res.status).toBe(204)

    const status = await c.json<FiltersStatus>('/api/filters')
    expect(status.sets.some(s => s.name === 'perso')).toBe(false)
  })
})

describe('GET /api/filters/sets/{name}/export', () => {
  it('should return a .sieve attachment with nosniff', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [MOVE_RULE] } })

    const res = await c.request('/api/filters/sets/perso/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/attachment/)
    expect(res.headers.get('content-disposition')).toMatch(/\.sieve/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const body = await res.text()
    expect(body).toContain('fileinto')
  })
})

describe('POST /api/filters/import', () => {
  it('should import a hand-written .sieve script as an unmanaged set named after the file', async () => {
    const c = await login()
    const script = 'require ["fileinto"];\nif header :contains "subject" "Facture" {\n  fileinto "INBOX.Projets";\n}\n'
    const fd = new FormData()
    fd.append('file', new Blob([script], { type: 'application/sieve' }), 'importe.sieve')
    // Script écrit à la main : confirmation obligatoire ; création → 201 (PLAN-v4 F).
    fd.append('confirmPassword', 'dev-password')

    const res = await fetch(url('/api/filters/import'), {
      method: 'POST',
      headers: { cookie: c.cookie, origin: origin() },
      body: fd,
    })
    expect(res.status).toBe(201)

    const set = await c.json<FilterSet>('/api/filters/sets/importe')
    expect(set.managed).toBe(false)
    expect(set.script).toContain('fileinto')
  })
})

describe('PUT /api/filters/sets/{name}/script — script écrit à la main', () => {
  it('should become unmanaged once saved with the account password confirmed', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const script = 'require ["fileinto"];\nif header :contains "subject" "Test" {\n  fileinto "INBOX.Projets";\n}\n'

    const ok = await c.request('/api/filters/sets/perso/script', { method: 'PUT', body: { script, confirmPassword: 'dev-password' } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as FilterSet).managed).toBe(false)

    const fetched = await c.json<FilterSet>('/api/filters/sets/perso')
    expect(fetched.managed).toBe(false)
  })

  it('should reject an invalid script with 400 from CHECKSCRIPT', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })

    const res = await c.request('/api/filters/sets/perso/script', {
      method: 'PUT',
      body: { script: 'ceci ne ressemble pas du tout à du sieve {{{', confirmPassword: 'dev-password' },
    })
    expect(res.status).toBe(400)
    const msg = await message(res)
    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Réponse automatique (vacation)
// ============================================================================

describe('GET/PUT /api/filters/vacation', () => {
  it('should always force replyFrom to the logged-in address, ignoring what the client sends', async () => {
    const c = await login()
    const before = await c.json<VacationSettings>('/api/filters/vacation')
    expect(before.replyFrom).toBe('dev@mmi-troyes.fr')

    const payload = {
      enabled: true,
      from: '2026-09-20',
      until: '2026-09-30',
      subject: 'Absent(e)',
      message: 'Je suis en congés, réponse à mon retour.',
      days: 5,
      addresses: ['dev.pro@mmi-troyes.fr'],
      replyFrom: 'attacker@example.com',
      incoming: 'keep',
      incomingAddress: null,
    }
    const putRes = await c.request('/api/filters/vacation', { method: 'PUT', body: payload })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as VacationSettings
    expect(putBody.replyFrom).toBe('dev@mmi-troyes.fr')

    const after = await c.json<VacationSettings>('/api/filters/vacation')
    expect(after).toEqual({ ...payload, replyFrom: 'dev@mmi-troyes.fr' })
  })

  it('should reject days outside 1-30 with 400, and accept the boundaries', async () => {
    const c = await login()
    const settings = {
      enabled: true,
      from: null,
      until: null,
      subject: 'Absent',
      message: 'Message',
      days: 7,
      addresses: [],
      replyFrom: 'dev@mmi-troyes.fr',
      incoming: 'keep',
      incomingAddress: null,
    }
    expect((await c.request('/api/filters/vacation', { method: 'PUT', body: { ...settings, days: 0 } })).status).toBe(400)
    expect((await c.request('/api/filters/vacation', { method: 'PUT', body: { ...settings, days: 31 } })).status).toBe(400)
    expect((await c.request('/api/filters/vacation', { method: 'PUT', body: { ...settings, days: 1 } })).status).toBe(200)
    expect((await c.request('/api/filters/vacation', { method: 'PUT', body: { ...settings, days: 30 } })).status).toBe(200)
  })
})

// ============================================================================
// Transfert (forward)
// ============================================================================

describe('GET/PUT /api/filters/forward', () => {
  it('should round-trip forward settings once confirmed with the account password', async () => {
    const c = await login()
    const before = await c.json<ForwardSettings>('/api/filters/forward')
    expect(before.enabled).toBe(false)

    const res = await c.request('/api/filters/forward', {
      method: 'PUT',
      body: { enabled: true, address: 'alice@mmi-troyes.fr', keepCopy: true, confirmPassword: 'dev-password' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ForwardSettings
    expect(body).toEqual({ enabled: true, address: 'alice@mmi-troyes.fr', keepCopy: true })

    const after = await c.json<ForwardSettings>('/api/filters/forward')
    expect(after).toEqual({ enabled: true, address: 'alice@mmi-troyes.fr', keepCopy: true })
  })

  it('should deliver the "transfert modifié" alert e-mail into the account INBOX', async () => {
    const c = await login()
    await c.request('/api/filters/forward', {
      method: 'PUT',
      body: { enabled: true, address: 'alice@mmi-troyes.fr', keepCopy: true, confirmPassword: 'dev-password' },
    })

    const inbox = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    expect(inbox.items.some(m => m.subject === 'Colombe : transfert modifié sur votre compte')).toBe(true)
  })
})

// ============================================================================
// Sécurité : confirmPassword pour toute redirection / notification / transfert / script
// ============================================================================

describe('sécurité — confirmPassword requis', () => {
  it('should refuse a forward change without confirmPassword, and with a wrong password', async () => {
    const c = await login()
    const noPassword = await c.request('/api/filters/forward', {
      method: 'PUT',
      body: { enabled: true, address: 'alice@mmi-troyes.fr', keepCopy: false },
    })
    expect(noPassword.status).toBe(403)
    expect(await message(noPassword)).toContain(CONFIRM_PASSWORD_MESSAGE)

    const wrongPassword = await c.request('/api/filters/forward', {
      method: 'PUT',
      body: { enabled: true, address: 'alice@mmi-troyes.fr', keepCopy: false, confirmPassword: 'wrong-password' },
    })
    expect(wrongPassword.status).toBe(403)
  })

  it('should refuse a hand-written script without confirmPassword', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const script = 'require ["fileinto"];\n'

    const res = await c.request('/api/filters/sets/perso/script', { method: 'PUT', body: { script } })
    expect(res.status).toBe(403)
    expect(await message(res)).toContain(CONFIRM_PASSWORD_MESSAGE)
  })

  it('should refuse a redirect rule without confirmPassword, and accept it with the right password', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const rule: FilterRule = {
      id: 'r-redirect',
      name: 'Redirection',
      enabled: true,
      match: 'all',
      conditions: [],
      actions: [{ type: 'redirect', address: 'alice@mmi-troyes.fr', keepCopy: false }],
    }

    const noPassword = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [rule] } })
    expect(noPassword.status).toBe(403)
    expect(await message(noPassword)).toContain(CONFIRM_PASSWORD_MESSAGE)

    const ok = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [rule], confirmPassword: 'dev-password' } })
    expect(ok.status).toBe(200)
  })
})

describe('sécurité — domaine de transfert interdit', () => {
  it('should refuse a redirect rule action to a foreign domain', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const rule: FilterRule = {
      id: 'r-redirect',
      name: 'Redirection externe',
      enabled: true,
      match: 'all',
      conditions: [],
      actions: [{ type: 'redirect', address: 'attacker@evil.example', keepCopy: false }],
    }
    const res = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [rule], confirmPassword: 'dev-password' } })
    expect(res.status).toBe(400)
    expect(await message(res)).toContain(FORBIDDEN_DOMAIN_MESSAGE)
  })

  it('should refuse a notify action with a mailto: to a foreign domain', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const rule: FilterRule = {
      id: 'r-notify',
      name: 'Alerte externe',
      enabled: true,
      match: 'all',
      conditions: [],
      actions: [{ type: 'notify', address: 'mailto:attacker@evil.example', message: 'Nouveau message' }],
    }
    const res = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [rule], confirmPassword: 'dev-password' } })
    expect(res.status).toBe(400)
    expect(await message(res)).toContain(FORBIDDEN_DOMAIN_MESSAGE)
  })

  it('should refuse a redirect hidden inside a hand-written script', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const script = 'require ["fileinto"];\nredirect "attacker@evil.example";\n'

    const res = await c.request('/api/filters/sets/perso/script', { method: 'PUT', body: { script, confirmPassword: 'dev-password' } })
    expect(res.status).toBe(400)
    expect(await message(res)).toContain(FORBIDDEN_DOMAIN_MESSAGE)
  })

  it('should refuse a forward to a foreign domain', async () => {
    const c = await login()
    const res = await c.request('/api/filters/forward', {
      method: 'PUT',
      body: { enabled: true, address: 'attacker@evil.example', keepCopy: false, confirmPassword: 'dev-password' },
    })
    expect(res.status).toBe(400)
    expect(await message(res)).toContain(FORBIDDEN_DOMAIN_MESSAGE)
  })

  it('should refuse vacation.incoming = redirect to a foreign domain', async () => {
    const c = await login()
    const settings = {
      enabled: true,
      from: null,
      until: null,
      subject: 'Absent',
      message: 'Message',
      days: 7,
      addresses: [],
      replyFrom: 'dev@mmi-troyes.fr',
      incoming: 'redirect',
      incomingAddress: 'attacker@evil.example',
    }
    const res = await c.request('/api/filters/vacation', { method: 'PUT', body: settings })
    expect(res.status).toBe(400)
    expect(await message(res)).toContain(FORBIDDEN_DOMAIN_MESSAGE)
  })
})

describe('sécurité — message de rejet limité à 500 caractères', () => {
  it('should refuse a reject action whose message exceeds 500 characters', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const rule: FilterRule = {
      id: 'r-reject',
      name: 'Rejet',
      enabled: true,
      match: 'all',
      conditions: [],
      actions: [{ type: 'reject', message: 'x'.repeat(501) }],
    }
    const res = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [rule] } })
    expect(res.status).toBe(400)
  })

  it('should accept a reject message of exactly 500 characters', async () => {
    const c = await login()
    await c.request('/api/filters/sets', { method: 'POST', body: { name: 'perso' } })
    const rule: FilterRule = {
      id: 'r-reject',
      name: 'Rejet',
      enabled: true,
      match: 'all',
      conditions: [],
      actions: [{ type: 'reject', message: 'x'.repeat(500) }],
    }
    const res = await c.request('/api/filters/sets/perso', { method: 'PUT', body: { rules: [rule] } })
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// Isolation entre utilisateurs
// ============================================================================

describe('isolation entre utilisateurs', () => {
  it('should not let alice see or fetch dev\'s filter sets', async () => {
    const dev = await login()
    await dev.request('/api/filters/sets', { method: 'POST', body: { name: 'perso-dev' } })

    const alice = await login('alice@mmi-troyes.fr')
    const status = await alice.json<FiltersStatus>('/api/filters')
    expect(status.sets.some(s => s.name === 'perso-dev')).toBe(false)

    const res = await alice.request('/api/filters/sets/perso-dev')
    expect(res.status).toBe(404)
  })
})

// ============================================================================
// Sécurité de base : authentification requise
// ============================================================================

describe('sécurité — authentification requise', () => {
  it('should return 401 without a session on every filters route', async () => {
    const c = client()
    expect((await c.request('/api/filters')).status).toBe(401)
    expect((await c.request('/api/filters/sets', { method: 'POST', body: { name: 'x' } })).status).toBe(401)
    expect((await c.request('/api/filters/vacation')).status).toBe(401)
    expect((await c.request('/api/filters/forward')).status).toBe(401)
  })
})
