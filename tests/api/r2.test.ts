/**
 * Tests boîte noire pour la vague R2 : identités, réponses types, carnet complet,
 * dossiers, réglages, volet de lecture, compte et sécurité.
 * Voir docs/dev/PLAN-v3.md sections R2.1-R2.8 et docs/dev/ROADMAP.md (R2.1b, R2.7).
 * Chaque test repart du jeu de données initial (POST /api/__mock/reset).
 *
 * Testeur aveugle : aucune lecture de app/, server/, shared/. Le contrat vient
 * uniquement de PLAN-v3.md / ROADMAP.md / tests existants.
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { Contact, Folder, MessageDetail, MessagePage, Prefs } from '#shared/types/mail'

const base = inject('apiBase')
const url = (path: string) => `${base}${path}`
const origin = () => new URL(url('/')).origin

// 1x1 PNG transparent, quelques dizaines d'octets décodés — bien sous les 200 Ko/image.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`

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
    async status(path, init = {}) {
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

async function findBySubject(c: Client, folder: string, subject: string) {
  const page = await c.json<MessagePage>(`/api/messages?folder=${encodeURIComponent(folder)}&pageSize=100`)
  return page.items.find(m => m.subject === subject)
}

async function rawOf(c: Client, folder: string, uid: number): Promise<string> {
  const res = await c.request(`/api/messages/${uid}/raw?folder=${encodeURIComponent(folder)}`)
  expect(res.status).toBe(200)
  return res.text()
}

beforeEach(async () => {
  const res = await fetch(url('/api/__mock/reset'), { method: 'POST', headers: { origin: origin() } })
  expect(res.status).toBe(204)
})

// ============================================================================
// R2.1 — Identités
// ============================================================================

describe('R2.1 — identité par défaut créée automatiquement', () => {
  it('GET /api/identities crée une identité par défaut à la première lecture', async () => {
    const c = await login()
    const identities = await c.json<any[]>('/api/identities')
    expect(identities).toHaveLength(1)
    expect(identities[0].name).toBe('dev')
    expect(identities[0].isDefault).toBe(true)
  })

  it('le nom par défaut dérive de la partie locale de chaque compte', async () => {
    const alice = await login('alice@universite.example')
    const identities = await alice.json<any[]>('/api/identities')
    expect(identities[0].name).toBe('alice')
  })
})

describe('R2.1 — création, 20 identités maximum', () => {
  it('POST /api/identities → 201 avec les champs fournis', async () => {
    const c = await login()
    await c.json('/api/identities') // déclenche la création de l'identité par défaut
    const res = await c.request('/api/identities', {
      method: 'POST',
      body: { name: 'Support Campus', replyTo: 'support@universite.example', bcc: 'archives@universite.example', organization: 'Université Exemple' },
    })
    expect(res.status).toBe(201)
    const identity = (await res.json()) as any
    expect(identity.name).toBe('Support Campus')
    expect(identity.replyTo).toBe('support@universite.example')
    expect(identity.organization).toBe('Université Exemple')
    expect(identity.isDefault).toBe(false)
  })

  it('refuse la 21e identité (400)', async () => {
    const c = await login()
    await c.json('/api/identities') // 1 identité (par défaut)
    for (let i = 0; i < 19; i++) {
      const res = await c.request('/api/identities', { method: 'POST', body: { name: `Identité ${i}` } })
      expect(res.status, `identité ${i}`).toBe(201)
    }
    // 20 identités au total désormais
    const list = await c.json<any[]>('/api/identities')
    expect(list).toHaveLength(20)
    const res = await c.request('/api/identities', { method: 'POST', body: { name: 'Identité 21' } })
    expect(res.status).toBe(400)
  })
})

describe('R2.1 — modification et suppression', () => {
  it('PATCH /api/identities/:id met à jour les champs fournis', async () => {
    const c = await login()
    const created = (await (await c.request('/api/identities', { method: 'POST', body: { name: 'Pro' } })).json()) as any
    const res = await c.request(`/api/identities/${created.id}`, {
      method: 'PATCH',
      body: { name: 'Pro Renommé', organization: 'Université Exemple' },
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as any
    expect(updated.name).toBe('Pro Renommé')
    expect(updated.organization).toBe('Université Exemple')
  })

  it('DELETE de la dernière identité → 400', async () => {
    const c = await login()
    const [only] = await c.json<any[]>('/api/identities')
    const res = await c.request(`/api/identities/${only.id}`, { method: 'DELETE' })
    expect(res.status).toBe(400)
  })

  it('supprimer l\'identité par défaut : la plus ancienne restante devient la nouvelle par défaut', async () => {
    const c = await login()
    const [first] = await c.json<any[]>('/api/identities') // identité par défaut auto-créée
    const second = (await (await c.request('/api/identities', { method: 'POST', body: { name: 'Deuxième' } })).json()) as any
    await c.request('/api/identities', { method: 'POST', body: { name: 'Troisième' } })

    const res = await c.request(`/api/identities/${first.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const remaining = await c.json<any[]>('/api/identities')
    expect(remaining.find((i: any) => i.id === first.id)).toBeUndefined()
    const newDefault = remaining.find((i: any) => i.isDefault)
    expect(newDefault?.id).toBe(second.id)
  })

  it('404 en modifiant ou supprimant l\'identité d\'un autre utilisateur', async () => {
    const dev = await login()
    const identity = (await (await dev.request('/api/identities', { method: 'POST', body: { name: 'Perso' } })).json()) as any
    const alice = await login('alice@universite.example')
    expect(await alice.status(`/api/identities/${identity.id}`, { method: 'PATCH', body: { name: 'Hack' } })).toBe(404)
    expect(await alice.status(`/api/identities/${identity.id}`, { method: 'DELETE' })).toBe(404)
  })
})

describe('R2.1 / R2.8 — envoi avec identité : From, Reply-To, image de signature en Content-ID', () => {
  it('POST /api/send avec identityId construit From et Reply-To, et convertit l\'image data: en pièce Content-ID', async () => {
    const c = await login()
    await c.json('/api/identities')
    const identity = (await (await c.request('/api/identities', {
      method: 'POST',
      body: { name: 'Support Campus', replyTo: 'support@universite.example' },
    })).json()) as any

    const signatureHtml = `<p>Cordialement,<br>Support Campus</p><img src="${TINY_PNG_DATA_URI}" alt="logo">`
    const patched = await c.request(`/api/identities/${identity.id}`, { method: 'PATCH', body: { signatureHtml } })
    expect(patched.status).toBe(200)

    const subject = `Avec identité ${Date.now()}`
    const sendRes = await c.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@universite.example'],
        cc: [],
        bcc: [],
        subject,
        html: `<p>Bonjour</p>${signatureHtml}`,
        identityId: identity.id,
      },
    })
    expect(sendRes.status).toBeLessThan(400)

    const sent = await findBySubject(c, 'INBOX.Envoyés', subject)
    expect(sent).toBeDefined()
    const raw = await rawOf(c, 'INBOX.Envoyés', sent!.uid)

    // Guillemets facultatifs autour d'un nom sans caractère spécial (RFC 5322).
    expect(raw).toMatch(/^From: "?Support Campus"? <dev@universite.example>/m)
    expect(raw).toMatch(/Reply-To:.*support@universite.example/i)
    expect(raw).not.toMatch(/data:image/i)
    expect(raw).toMatch(/Content-ID:/i)
  })

  it('sans identityId, From utilise l\'identité par défaut', async () => {
    const c = await login()
    await c.json('/api/identities')
    const subject = `Sans identité ${Date.now()}`
    await c.request('/api/send', { method: 'POST', body: { to: ['alice@universite.example'], cc: [], bcc: [], subject, text: 'Corps' } })
    const sent = await findBySubject(c, 'INBOX.Envoyés', subject)
    const raw = await rawOf(c, 'INBOX.Envoyés', sent!.uid)
    expect(raw).toContain('<dev@universite.example>')
  })
})

describe('R2.8 — assainissement des images sortantes', () => {
  it('rejette http(s) et data:image/svg+xml dans une signature (retirés silencieusement)', async () => {
    const c = await login()
    const [identity] = await c.json<any[]>('/api/identities')
    const res = await c.request(`/api/identities/${identity.id}`, {
      method: 'PATCH',
      body: {
        signatureHtml: `<p>Sig</p><img src="https://evil.example/pixel.png" alt="x"><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="svg"><img src="${TINY_PNG_DATA_URI}" alt="ok">`,
      },
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as any
    expect(updated.signatureHtml).not.toContain('evil.example')
    expect(updated.signatureHtml).not.toContain('image/svg')
    expect(updated.signatureHtml).toContain('data:image/png')
  })

  it('POST /api/send : les images https:// et data:image/svg+xml du corps sont retirées, l\'image PNG data: devient une pièce Content-ID', async () => {
    const c = await login()
    const subject = `Assainissement envoi ${Date.now()}`
    const html = `<p>Texte</p><img src="https://tracker.example/pixel.png" alt="t"><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="svg"><img src="${TINY_PNG_DATA_URI}" alt="ok">`
    const res = await c.request('/api/send', { method: 'POST', body: { to: ['alice@universite.example'], cc: [], bcc: [], subject, html } })
    expect(res.status).toBeLessThan(400)

    const sent = await findBySubject(c, 'INBOX.Envoyés', subject)
    const raw = await rawOf(c, 'INBOX.Envoyés', sent!.uid)
    expect(raw).not.toContain('tracker.example')
    expect(raw).not.toMatch(/image\/svg/i)
    expect(raw).toMatch(/Content-ID:/i)
    expect(raw).not.toMatch(/data:image/i)
  })

  it('refuse une image data: dépassant 200 Ko décodés dans une signature (400)', async () => {
    const c = await login()
    const [identity] = await c.json<any[]>('/api/identities')
    const huge = `data:image/png;base64,${'A'.repeat(300_000)}`
    const res = await c.request(`/api/identities/${identity.id}`, {
      method: 'PATCH',
      body: { signatureHtml: `<p>Sig</p><img src="${huge}" alt="grosse image">` },
    })
    expect(res.status).toBe(400)
  })
})

// ============================================================================
// R2.2 — Réponses types
// ============================================================================

describe('R2.2 — réponses types (CRUD et limites)', () => {
  it('GET /api/responses → [] initialement', async () => {
    const c = await login()
    const list = await c.json<any[]>('/api/responses')
    expect(list).toEqual([])
  })

  it('POST /api/responses → 201, contenu assaini comme une signature', async () => {
    const c = await login()
    const res = await c.request('/api/responses', {
      method: 'POST',
      body: { name: 'Merci', html: '<p>Merci <script>alert(1)</script>de votre message.</p>' },
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as any
    expect(created.name).toBe('Merci')
    expect(created.html).not.toContain('<script>')
    expect(created.html).toContain('Merci')
  })

  it('refuse un nom de plus de 100 caractères (400)', async () => {
    const c = await login()
    const res = await c.request('/api/responses', { method: 'POST', body: { name: 'a'.repeat(101), html: '<p>Texte</p>' } })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/responses/:id met à jour le nom et le contenu', async () => {
    const c = await login()
    const created = (await (await c.request('/api/responses', { method: 'POST', body: { name: 'Initial', html: '<p>A</p>' } })).json()) as any
    const res = await c.request(`/api/responses/${created.id}`, { method: 'PATCH', body: { name: 'Renommé', html: '<p>B</p>' } })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as any
    expect(updated.name).toBe('Renommé')
    expect(updated.html).toContain('B')
  })

  it('DELETE /api/responses/:id → 204, retiré de la liste', async () => {
    const c = await login()
    const created = (await (await c.request('/api/responses', { method: 'POST', body: { name: 'À supprimer', html: '<p>A</p>' } })).json()) as any
    const res = await c.request(`/api/responses/${created.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    const list = await c.json<any[]>('/api/responses')
    expect(list.find((r: any) => r.id === created.id)).toBeUndefined()
  })

  it('404 sur une réponse inexistante ou d\'un autre utilisateur', async () => {
    const dev = await login()
    const created = (await (await dev.request('/api/responses', { method: 'POST', body: { name: 'Privée', html: '<p>A</p>' } })).json()) as any
    expect(await dev.status('/api/responses/999999', { method: 'PATCH', body: { name: 'x' } })).toBe(404)
    const alice = await login('alice@universite.example')
    expect(await alice.status(`/api/responses/${created.id}`, { method: 'DELETE' })).toBe(404)
  })

  it('refuse la 101e réponse type (400)', async () => {
    const c = await login()
    for (let i = 0; i < 100; i++) {
      const res = await c.request('/api/responses', { method: 'POST', body: { name: `Réponse ${i}`, html: '<p>A</p>' } })
      expect(res.status, `réponse ${i}`).toBe(201)
    }
    const res = await c.request('/api/responses', { method: 'POST', body: { name: 'Réponse 101', html: '<p>A</p>' } })
    expect(res.status).toBe(400)
  })
})

// ============================================================================
// R2.3 — Carnet d'adresses complet
// ============================================================================

describe('R2.3 — fiche contact complète', () => {
  it('PUT /api/contacts/:id enregistre tous les champs de ContactDetail', async () => {
    const c = await login()
    const created = (await (await c.request('/api/contacts', { method: 'POST', body: { email: 'lea.dubois@universite.example', name: 'Léa Dubois' } })).json()) as Contact
    const detailInput = {
      firstName: 'Léa',
      lastName: 'Dubois',
      displayName: 'Léa Dubois',
      // Contrat typé (PLAN-v3 R2.8) : libellés home | work | other, champ « address ».
      emails: [
        { label: 'work', address: 'lea.dubois@universite.example' },
        { label: 'home', address: 'lea.perso@example.com' },
      ],
      phones: [{ label: 'mobile', number: '+33 6 12 34 56 78' }],
      organization: 'Université Exemple',
      jobTitle: 'Enseignante',
      address: { street: '10 rue Marie Curie', postalCode: '10000', city: 'Troyes', country: 'France' },
      birthday: '1990-05-12',
      notes: 'Contact de test R2.3',
    }
    const res = await c.request(`/api/contacts/${created.id}`, { method: 'PUT', body: detailInput })
    expect(res.status).toBe(200)

    const detail = await c.json<any>(`/api/contacts/${created.id}`)
    expect(detail.firstName).toBe('Léa')
    expect(detail.lastName).toBe('Dubois')
    expect(detail.organization).toBe('Université Exemple')
    expect(detail.jobTitle).toBe('Enseignante')
    expect(detail.notes).toBe('Contact de test R2.3')
    expect(detail.emails).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'work', address: 'lea.dubois@universite.example' }),
      expect.objectContaining({ label: 'home', address: 'lea.perso@example.com' }),
    ]))
    expect(detail.phones).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'mobile', number: '+33 6 12 34 56 78' })]))
    expect(detail.address).toEqual({ street: '10 rue Marie Curie', postalCode: '10000', city: 'Troyes', country: 'France' })
    expect(detail.birthday).toBe('1990-05-12')
  })

  it('l\'autocomplétion trouve un contact par un e-mail secondaire', async () => {
    const c = await login()
    const created = (await (await c.request('/api/contacts', { method: 'POST', body: { email: 'bob@example.com', name: 'Bob' } })).json()) as Contact
    // PUT remplace la fiche entière : tous les champs de ContactDetailInput sont fournis.
    const put = await c.request(`/api/contacts/${created.id}`, {
      method: 'PUT',
      body: {
        firstName: 'Bob', lastName: '', displayName: 'Bob', phones: [], organization: '', jobTitle: '',
        address: null, birthday: null, notes: '',
        emails: [{ label: 'work', address: 'bob@example.com' }, { label: 'other', address: 'bobby@secondary.example' }],
      },
    })
    expect(put.status).toBe(200)
    const results = await c.json<Contact[]>('/api/contacts?q=bobby')
    expect(results.some(r => r.id === created.id)).toBe(true)
  })
})

describe('R2.3 — groupes de contacts', () => {
  it('POST /api/contact-groups → 201, apparaît dans GET', async () => {
    const c = await login()
    const res = await c.request('/api/contact-groups', { method: 'POST', body: { name: 'Enseignants' } })
    expect(res.status).toBe(201)
    const group = (await res.json()) as any
    expect(group.name).toBe('Enseignants')
    const list = await c.json<any[]>('/api/contact-groups')
    expect(list.some((g: any) => g.id === group.id)).toBe(true)
  })

  it('PATCH renomme, DELETE supprime le groupe', async () => {
    const c = await login()
    const group = (await (await c.request('/api/contact-groups', { method: 'POST', body: { name: 'Temp' } })).json()) as any
    const renamed = await c.request(`/api/contact-groups/${group.id}`, { method: 'PATCH', body: { name: 'Renommé' } })
    expect(renamed.status).toBe(200)
    expect(((await renamed.json()) as any).name).toBe('Renommé')

    const deleted = await c.request(`/api/contact-groups/${group.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    const list = await c.json<any[]>('/api/contact-groups')
    expect(list.some((g: any) => g.id === group.id)).toBe(false)
  })

  it('ajoute et retire des membres, avec withGroups=1 dans l\'autocomplétion', async () => {
    const c = await login()
    const contact = (await (await c.request('/api/contacts', { method: 'POST', body: { email: 'lea.dubois@universite.example', name: 'Léa Dubois' } })).json()) as Contact
    const group = (await (await c.request('/api/contact-groups', { method: 'POST', body: { name: 'Enseignants' } })).json()) as any

    const added = await c.request(`/api/contact-groups/${group.id}/members`, { method: 'POST', body: { contactIds: [contact.id] } })
    expect(added.status).toBe(204)

    const result = await c.json<{ contacts: Contact[]; groups: { id: number; name: string; emails: string[] }[] }>(`/api/contacts?q=Enseignants&withGroups=1`)
    expect(result.groups.length).toBeGreaterThan(0)
    const found = result.groups.find(g => g.id === group.id)
    expect(found).toBeDefined()
    expect(found?.emails).toContain('lea.dubois@universite.example')

    const removed = await c.request(`/api/contact-groups/${group.id}/members`, { method: 'DELETE', body: { contactIds: [contact.id] } })
    expect(removed.status).toBe(204)
    const after = await c.json<{ contacts: Contact[]; groups: { id: number; name: string; emails: string[] }[] }>(`/api/contacts?q=Enseignants&withGroups=1`)
    const groupAfter = after.groups.find(g => g.id === group.id)
    expect(groupAfter?.emails ?? []).not.toContain('lea.dubois@universite.example')
  })
})

describe('R2.3 — export et import vCard/CSV', () => {
  it('GET /api/contacts/export.vcf → vCard 3.0 relisible', async () => {
    const c = await login()
    await c.request('/api/contacts', { method: 'POST', body: { email: 'lea.dubois@universite.example', name: 'Léa Dubois' } })
    const res = await c.request('/api/contacts/export.vcf')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('BEGIN:VCARD')
    expect(text).toContain('VERSION:3.0')
    expect(text).toContain('END:VCARD')
    expect(text).toMatch(/EMAIL[^\r\n]*lea\.dubois@universite.example/)
  })

  it('POST /api/contacts/import (.vcf) → { imported: 1, skipped: 0 }', async () => {
    const c = await login()
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Dubois;Léa;;;',
      'FN:Léa Dubois',
      'EMAIL;TYPE=WORK:lea.dubois@universite.example',
      'TEL;TYPE=CELL:+33 6 12 34 56 78',
      'ORG:Université Exemple',
      'TITLE:Enseignante',
      'END:VCARD',
      '',
    ].join('\r\n')
    const fd = new FormData()
    fd.append('file', new Blob([vcard], { type: 'text/vcard' }), 'lea-dubois.vcf')
    const res = await fetch(url('/api/contacts/import'), { method: 'POST', headers: { cookie: c.cookie, origin: origin() }, body: fd })
    expect(res.status).toBe(200)
    const result = (await res.json()) as { imported: number; skipped: number }
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)

    const found = await c.json<Contact[]>('/api/contacts?q=lea.dubois')
    expect(found.some(ct => ct.email === 'lea.dubois@universite.example')).toBe(true)
  })

  it('POST /api/contacts/import (.csv) : une ligne sans e-mail est ignorée (skipped)', async () => {
    const c = await login()
    const csv = [
      'Prénom,Nom,E-mail,Téléphone,Organisation',
      'Marc,Petit,marc.petit@example.com,+33 6 00 00 00 00,Université Exemple',
      'SansEmail,Personne,,,',
    ].join('\r\n')
    const fd = new FormData()
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'contacts.csv')
    const res = await fetch(url('/api/contacts/import'), { method: 'POST', headers: { cookie: c.cookie, origin: origin() }, body: fd })
    expect(res.status).toBe(200)
    const result = (await res.json()) as { imported: number; skipped: number }
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('deux imports du même e-mail fusionnent (pas de doublon)', async () => {
    const c = await login()
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Marc Petit', 'EMAIL:marc.petit@example.com', 'END:VCARD', ''].join('\r\n')
    for (let i = 0; i < 2; i++) {
      const fd = new FormData()
      fd.append('file', new Blob([vcard], { type: 'text/vcard' }), 'marc.vcf')
      const res = await fetch(url('/api/contacts/import'), { method: 'POST', headers: { cookie: c.cookie, origin: origin() }, body: fd })
      expect(res.status).toBe(200)
    }
    const found = await c.json<Contact[]>('/api/contacts?q=marc.petit')
    expect(found).toHaveLength(1)
  })
})

// ============================================================================
// R2.4 — Dossiers
// ============================================================================

describe('R2.4 — abonnement et visibilité', () => {
  it('GET /api/folders (sans all) ne renvoie que les dossiers abonnés ; ?all=1 renvoie tout', async () => {
    const c = await login()
    const subscribed = await c.json<Folder[]>('/api/folders')
    expect(subscribed.some(f => f.path === 'INBOX.Anciens cours')).toBe(false)

    const all = await c.json<Folder[]>('/api/folders?all=1')
    const anciens = all.find(f => f.path === 'INBOX.Anciens cours')
    expect(anciens).toBeDefined()
    expect(anciens?.subscribed).toBe(false)
  })

  it('POST /api/folders/subscribe active un dossier masqué', async () => {
    const c = await login()
    const res = await c.request('/api/folders/subscribe', { method: 'POST', body: { path: 'INBOX.Anciens cours', subscribed: true } })
    expect(res.status).toBe(204)
    const subscribed = await c.json<Folder[]>('/api/folders')
    expect(subscribed.some(f => f.path === 'INBOX.Anciens cours')).toBe(true)
  })
})

describe('R2.4 — quota et taille', () => {
  it('GET /api/folders/quota → { usedBytes, limitBytes } avec 1 Gio en mock', async () => {
    const c = await login()
    const quota = await c.json<{ usedBytes: number; limitBytes: number | null }>('/api/folders/quota')
    expect(typeof quota.usedBytes).toBe('number')
    expect(quota.usedBytes).toBeGreaterThan(0)
    expect(quota.limitBytes).toBe(1024 * 1024 * 1024)
  })

  it('GET /api/folders/size?path=INBOX → { bytes, messages } avec 72 messages', async () => {
    const c = await login()
    const size = await c.json<{ bytes: number; messages: number }>('/api/folders/size?path=INBOX')
    expect(size.messages).toBe(72)
    expect(size.bytes).toBeGreaterThan(0)
  })
})

describe('R2.4 — sous-dossiers et déplacement', () => {
  it('la donnée de test INBOX.Projets.2026 existe avec son message', async () => {
    const c = await login()
    const all = await c.json<Folder[]>('/api/folders?all=1')
    expect(all.some(f => f.path === 'INBOX.Projets.2026')).toBe(true)
    const msg = await findBySubject(c, 'INBOX.Projets.2026', 'Projet 2026 — cahier des charges')
    expect(msg).toBeDefined()
  })

  it('POST /api/folders avec parent crée un sous-dossier au bon chemin', async () => {
    const c = await login()
    const res = await c.request('/api/folders', { method: 'POST', body: { name: 'Archivé', parent: 'INBOX.Projets' } })
    expect(res.status).toBe(201)
    const folder = (await res.json()) as Folder
    expect(folder.path).toBe('INBOX.Projets.Archivé')
  })

  it('PATCH /api/folders avec parent:null déplace le dossier à la racine', async () => {
    const c = await login()
    const created = (await (await c.request('/api/folders', { method: 'POST', body: { name: 'ADéplacer', parent: 'INBOX.Projets' } })).json()) as Folder
    expect(created.path).toBe('INBOX.Projets.ADéplacer')

    const moved = await c.request('/api/folders', { method: 'PATCH', body: { path: created.path, parent: null } })
    expect(moved.status).toBe(200)
    const result = (await moved.json()) as { path: string }
    expect(result.path).toBe('INBOX.ADéplacer')

    const all = await c.json<Folder[]>('/api/folders?all=1')
    expect(all.some(f => f.path === 'INBOX.Projets.ADéplacer')).toBe(false)
    expect(all.some(f => f.path === 'INBOX.ADéplacer')).toBe(true)
  })
})

// ============================================================================
// R2.5 — Volet de lecture et préférences d'affichage
// ============================================================================

describe('R2.5 — validation des préférences', () => {
  it('PUT /api/prefs accepte toutes les clés R2 avec des valeurs valides', async () => {
    const c = await login()
    const body = {
      readingPane: 'right',
      markReadDelay: 5,
      preferHtml: false,
      remoteImages: 'contacts',
      timeZone: 'Europe/Paris',
      dateFormat: 'short',
      timeFormat: '12h',
      replyPosition: 'below',
      composeHtml: false,
      logoutEmptyTrash: true,
      logoutExpunge: true,
      deleteMode: 'permanent',
    }
    const res = await c.request('/api/prefs', { method: 'PUT', body })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as any
    for (const [key, value] of Object.entries(body)) {
      expect(updated[key], key).toBe(value)
    }
  })

  it.each([
    ['readingPane', 'left'],
    ['markReadDelay', 7],
    ['remoteImages', 'sometimes'],
    ['dateFormat', 'iso'],
    ['timeFormat', '30h'],
    ['replyPosition', 'inline'],
    ['deleteMode', 'archive'],
  ])('rejette une valeur invalide pour %s (400)', async (key, value) => {
    const c = await login()
    const res = await c.request('/api/prefs', { method: 'PUT', body: { [key]: value } })
    expect(res.status).toBe(400)
  })

  it('rejette une clé inconnue (400)', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', { method: 'PUT', body: { cleInconnue: 'valeur' } })
    expect(res.status).toBe(400)
  })

  it('signatureHtml de Prefs (compatibilité) est recopié dans l\'identité par défaut à sa création', async () => {
    const c = await login()
    const res = await c.request('/api/prefs', { method: 'PUT', body: { signatureHtml: '<p>Signature historique</p>' } })
    expect(res.status).toBe(200)
    // Première lecture : déclenche la création de l'identité par défaut.
    const [identity] = await c.json<any[]>('/api/identities')
    expect(identity.signatureHtml).toContain('Signature historique')
  })
})

// ============================================================================
// R2.6 — Compte et sécurité
// ============================================================================

describe('R2.6 — activité du compte', () => {
  it('GET /api/account/activity : lastLogin correspond à la connexion précédente, pas à la courante', async () => {
    await login() // première connexion
    const c = await login() // deuxième connexion, nouvelle session
    const activity = await c.json<{ lastLogin: { date: string } | null; recent: unknown[] }>('/api/account/activity')
    expect(activity.lastLogin).not.toBeNull()
    expect(Array.isArray(activity.recent)).toBe(true)
    expect(activity.recent.length).toBeGreaterThan(0)
  })

  it('requiert une session', async () => {
    const c = client()
    expect(await c.status('/api/account/activity')).toBe(401)
  })
})

describe('R2.6 — sessions actives', () => {
  it('GET /api/account/sessions : id à 8 caractères hexadécimaux, exactement une session marquée current', async () => {
    const c = await login()
    const sessions = await c.json<any[]>('/api/account/sessions')
    expect(sessions.length).toBeGreaterThan(0)
    for (const s of sessions) expect(s.id).toMatch(/^[0-9a-f]{8}$/)
    expect(sessions.filter((s: any) => s.current).length).toBe(1)
  })

  it('POST /api/account/sessions/revoke-others déconnecte les autres sessions', async () => {
    const a = await login()
    const b = await login()
    const res = await b.request('/api/account/sessions/revoke-others', { method: 'POST' })
    expect(res.status).toBe(204)
    expect(await a.status('/api/account/sessions')).toBe(401)
    expect(await b.status('/api/account/sessions')).toBe(200)
  })

  it('DELETE /api/account/sessions/:id déconnecte précisément cette session', async () => {
    const a = await login()
    const b = await login()
    // La session de `a`, identifiée par `a` lui-même (d'autres sessions peuvent exister).
    const sessionsFromA = await a.json<any[]>('/api/account/sessions')
    const other = sessionsFromA.find((s: any) => s.current)
    expect(other).toBeDefined()
    const sessionsFromB = await b.json<any[]>('/api/account/sessions')
    expect(sessionsFromB.find((s: any) => s.id === other.id)?.current).toBe(false)

    const res = await b.request(`/api/account/sessions/${other.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    expect(await a.status('/api/account/sessions')).toBe(401)
    expect(await b.status('/api/account/sessions')).toBe(200)
  })
})

// ============================================================================
// R2.8 — Compléments : listPost, senderInContacts, deleteMode, données de test
// ============================================================================

describe('R2.8 — données de test dédiées', () => {
  it('la boîte de réception contient 72 messages', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')
    expect(page.total).toBe(72)
  })

  it('MessageDetail.listPost expose l\'adresse sans mailto:', async () => {
    const c = await login()
    const msg = await findBySubject(c, 'INBOX', 'Liste Promo 2026 : réunion de rentrée')
    expect(msg).toBeDefined()
    const detail = await c.json<MessageDetail & { listPost?: string | null }>(`/api/messages/${msg!.uid}?folder=INBOX`)
    expect(detail.listPost).toBe('liste-promo2026@universite.example')
  })

  it('les autres messages n\'ont pas de listPost', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    const detail = await c.json<MessageDetail & { listPost?: string | null }>(`/api/messages/${msg.uid}?folder=INBOX`)
    expect(detail.listPost).toBeFalsy()
  })
})

describe('R2.8 — senderInContacts', () => {
  it('passe de false à true après ajout de l\'expéditeur aux contacts', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    const before = await c.json<MessageDetail & { senderInContacts?: boolean }>(`/api/messages/${msg.uid}?folder=INBOX`)
    expect(before.senderInContacts).toBe(false)

    await c.request('/api/contacts', { method: 'POST', body: { email: before.from!.address, name: before.from!.name ?? before.from!.address } })

    const after = await c.json<MessageDetail & { senderInContacts?: boolean }>(`/api/messages/${msg.uid}?folder=INBOX`)
    expect(after.senderInContacts).toBe(true)
  })
})

describe('R2.8 — deleteMode permanent', () => {
  it('supprime définitivement au lieu de déplacer vers la Corbeille', async () => {
    const c = await login()
    await c.request('/api/prefs', { method: 'PUT', body: { deleteMode: 'permanent' } })
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    const res = await c.request('/api/messages/delete', { method: 'POST', body: { folder: 'INBOX', uids: [msg.uid] } })
    expect(res.status).toBe(204)

    expect(await findBySubject(c, 'INBOX', msg.subject)).toBeUndefined()
    expect(await findBySubject(c, 'INBOX.Corbeille', msg.subject)).toBeUndefined()
  })
})

// ============================================================================
// Sécurité : les nouvelles routes R2 nécessitent une session
// ============================================================================

describe('sécurité — authentification requise sur les routes R2', () => {
  it('401 sans session', async () => {
    const c = client()
    expect(await c.status('/api/identities')).toBe(401)
    expect(await c.status('/api/responses')).toBe(401)
    expect(await c.status('/api/contact-groups')).toBe(401)
    expect(await c.status('/api/folders/quota')).toBe(401)
    expect(await c.status('/api/account/sessions')).toBe(401)
    expect(await c.status('/api/contacts/export.vcf')).toBe(401)
  })
})
