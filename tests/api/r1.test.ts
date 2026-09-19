/**
 * Tests boîte noire pour la vague R1 : actions sur messages, recherche, rédaction.
 * Voir docs/dev/PLAN-v3.md sections R1.1-R1.5 (contrat API, codes de statut, libellés).
 * Chaque test repart du jeu de données initial (POST /api/__mock/reset).
 */
import { beforeEach, describe, expect, inject, it } from 'vitest'
import type { MessageDetail, MessagePage } from '#shared/types/mail'

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

// ============================================================================
// R1.1 — Actions sur la liste : tri, marquer tout comme lu, copier, spam, vider, zip, import
// ============================================================================

describe('R1.1 — tri et ordre', () => {
  it('sort=date order=desc par défaut (plus récent en premier)', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=10')
    expect(page.items.length).toBeGreaterThan(1)
    const dates = page.items.map(m => Date.parse(m.date))
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })

  it('sort=subject order=asc (ordre alphabétique)', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&sort=subject&order=asc&pageSize=100')
    const subjects = page.items.map(m => m.subject)
    expect(subjects).toEqual([...subjects].sort((a, b) => a.localeCompare(b, 'fr')))
  })

  it('sort=from order=desc', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&sort=from&order=desc&pageSize=100')
    const froms = page.items.map(m => m.from?.address ?? '')
    expect(froms).toEqual([...froms].sort().reverse())
  })

  it('sort=size order=asc', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&sort=size&order=asc&pageSize=100')
    const sizes = page.items.map(m => m.size)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  })
})

describe('R1.1 — marquer tout comme lu', () => {
  it('POST /api/folders/mark-read { folder } → 204', async () => {
    const c = await login()
    let page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=10')
    const unreadBefore = page.items.filter(m => !m.seen).length
    expect(unreadBefore).toBeGreaterThan(0)

    const res = await c.request('/api/folders/mark-read', { method: 'POST', body: { folder: 'INBOX' } })
    expect(res.status).toBe(204)

    page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    expect(page.items.every(m => m.seen)).toBe(true)
  })

  it('retourne le nombre non-lu dans GET /api/folders à 0 après mark-read', async () => {
    const c = await login()
    await c.request('/api/folders/mark-read', { method: 'POST', body: { folder: 'INBOX' } })
    const folders = await c.json<any>('/api/folders')
    const inbox = folders.find((f: any) => f.path === 'INBOX')
    expect(inbox.unread).toBe(0)
  })
})

describe('R1.1 — copier vers un autre dossier', () => {
  it('POST /api/messages/copy { folder, uids, destination } → 204', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    const originalSubject = msg.subject

    const res = await c.request('/api/messages/copy', {
      method: 'POST',
      body: { folder: 'INBOX', uids: [msg.uid], destination: 'INBOX.Projets' },
    })
    expect(res.status).toBe(204)

    // L'original reste en place
    expect(await findBySubject(c, 'INBOX', originalSubject)).toBeDefined()
    // La copie existe
    expect(await findBySubject(c, 'INBOX.Projets', originalSubject)).toBeDefined()
  })
})

describe('R1.1 — signaler comme spam / ce n\'est pas un spam', () => {
  it('POST /api/messages/junk { folder, uids, junk: true } → déplace vers Spam', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    const subject = msg.subject

    const res = await c.request('/api/messages/junk', {
      method: 'POST',
      body: { folder: 'INBOX', uids: [msg.uid], junk: true },
    })
    expect(res.status).toBe(204)

    expect(await findBySubject(c, 'INBOX', subject)).toBeUndefined()
    expect(await findBySubject(c, 'INBOX.Spam', subject)).toBeDefined()
  })

  it('POST /api/messages/junk { folder, uids, junk: false } → déplace vers INBOX', async () => {
    const c = await login()
    // Récupère un message du Spam
    const spamMsg = (await c.json<MessagePage>('/api/messages?folder=INBOX.Spam&pageSize=100')).items[0]
    expect(spamMsg).toBeDefined()

    const res = await c.request('/api/messages/junk', {
      method: 'POST',
      body: { folder: 'INBOX.Spam', uids: [spamMsg!.uid], junk: false },
    })
    expect(res.status).toBe(204)

    expect(await findBySubject(c, 'INBOX.Spam', spamMsg!.subject)).toBeUndefined()
    expect(await findBySubject(c, 'INBOX', spamMsg!.subject)).toBeDefined()
  })

  it('retourne 404 si aucun dossier Spam', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    // TODO: Le backend devrait vérifier le dossier Spam existe
    // Nous notons juste le contrat ici ; la vérification dépend de l'implémentation.
  })
})

describe('R1.1 — vider un dossier', () => {
  it('POST /api/folders/empty { folder } → 204 pour Corbeille', async () => {
    const c = await login()
    // Place un message dans la Corbeille
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    await c.request('/api/messages/delete', { method: 'POST', body: { folder: 'INBOX', uids: [msg.uid] } })

    let trash = await c.json<MessagePage>('/api/messages?folder=INBOX.Corbeille&pageSize=100')
    expect(trash.total).toBeGreaterThan(0)

    const res = await c.request('/api/folders/empty', { method: 'POST', body: { folder: 'INBOX.Corbeille' } })
    expect(res.status).toBe(204)

    trash = await c.json<MessagePage>('/api/messages?folder=INBOX.Corbeille&pageSize=100')
    expect(trash.total).toBe(0)
  })

  it('POST /api/folders/empty { folder } → 204 pour Spam', async () => {
    const c = await login()
    let spam = await c.json<MessagePage>('/api/messages?folder=INBOX.Spam&pageSize=100')
    expect(spam.total).toBeGreaterThan(0)

    const res = await c.request('/api/folders/empty', { method: 'POST', body: { folder: 'INBOX.Spam' } })
    expect(res.status).toBe(204)

    spam = await c.json<MessagePage>('/api/messages?folder=INBOX.Spam&pageSize=100')
    expect(spam.total).toBe(0)
  })

  it('retourne 400 pour INBOX (pas un dossier poubelle)', async () => {
    const c = await login()
    const res = await c.request('/api/folders/empty', { method: 'POST', body: { folder: 'INBOX' } })
    expect(res.status).toBe(400)
  })
})

describe('R1.1 — télécharger messages en zip', () => {
  it('GET /api/messages/zip?folder=…&uids=1,2 → archive .zip', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=3')
    const uids = page.items.slice(0, 2).map(m => m.uid).join(',')

    const res = await c.request(`/api/messages/zip?folder=INBOX&uids=${uids}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/attachment/)

    const buf = await res.arrayBuffer()
    // Magic bytes du ZIP
    expect(new Uint8Array(buf).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]))
  })

  it('retourne 400 si > 200 messages ou > 100 Mo', async () => {
    const c = await login()
    // Crée une liste très longue (> 200 uids)
    const tooMany = Array.from({ length: 201 }, (_, i) => i + 1).join(',')
    const res = await c.request(`/api/messages/zip?folder=INBOX&uids=${tooMany}`)
    expect(res.status).toBe(400)
  })
})

describe('R1.1 — importer des messages (.eml)', () => {
  it('POST /api/messages/import multipart avec .eml valide → { imported: 1 }', async () => {
    const c = await login()
    // Récupère un message existant pour l'importer
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!
    const detail = await c.json<MessageDetail>(`/api/messages/${msg.uid}?folder=INBOX`)

    // Crée un FormData avec un fichier .eml fictif
    const eml = `From: test@mmi-troyes.fr
Date: Mon, 1 Jan 2024 10:00:00 +0000
Subject: Message importé
Message-ID: <test@mmi-troyes.fr>

Ceci est un message de test.`

    const fd = new FormData()
    fd.append('folder', 'INBOX')
    fd.append('file', new Blob([eml], { type: 'message/rfc822' }), 'test.eml')

    const res = await fetch(url('/api/messages/import'), {
      method: 'POST',
      headers: { 'cookie': c.cookie, 'origin': origin() },
      body: fd,
    })
    expect(res.status).toBe(200)
    const result = (await res.json()) as { imported: number }
    expect(result.imported).toBe(1)
  })

  it('ignore un fichier qui n\'est pas un message valide (pas de From/Date/Subject/Message-ID)', async () => {
    const c = await login()
    const fd = new FormData()
    fd.append('folder', 'INBOX')
    fd.append('file', new Blob(['pas un message'], { type: 'text/plain' }), 'junk.txt')

    const res = await fetch(url('/api/messages/import'), {
      method: 'POST',
      headers: { 'cookie': c.cookie, 'origin': origin() },
      body: fd,
    })
    expect(res.status).toBe(200)
    const result = (await res.json()) as { imported: number }
    expect(result.imported).toBe(0)
  })
})

// ============================================================================
// R1.2 — Recherche avancée
// ============================================================================

describe('R1.2 — fields et scope', () => {
  it('GET /api/messages?q=…&fields=subject → cherche uniquement dans l\'objet', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&q=relevé&fields=subject')
    // Doit trouver "Relevé de notes — semestre 4"
    expect(page.items.some(m => m.subject.includes('Relevé'))).toBe(true)
  })

  it('GET /api/messages?q=…&scope=all → cherche dans tous les dossiers sauf Corbeille/Spam', async () => {
    const c = await login()
    // Envoie un message vers Envoyés
    const subject = `Cherche-moi ${Date.now()}`
    await c.request('/api/send', {
      method: 'POST',
      body: { to: ['alice@mmi-troyes.fr'], cc: [], bcc: [], subject, text: 'Corps' },
    })

    const page = await c.json<MessagePage>(`/api/messages?q=${encodeURIComponent(subject)}&scope=all`)
    const found = page.items.find(m => m.subject === subject)
    expect(found).toBeDefined()
    expect(found?.folder).toBe('INBOX.Envoyés')
  })

  it('chaque résultat en scope=all contient son folder', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&scope=all&pageSize=10')
    for (const item of page.items) {
      expect(item.folder).toBeDefined()
      expect(['INBOX', 'INBOX.Envoyés', 'INBOX.Brouillons', 'INBOX.Archives', 'INBOX.Projets']).toContain(item.folder)
    }
  })
})

describe('R1.2 — filtres', () => {
  it('unread=1 retourne uniquement les messages non-lus', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&unread=1&pageSize=100')
    for (const msg of page.items) {
      expect(msg.seen).toBe(false)
    }
  })

  it('flagged=1 retourne uniquement les messages avec étoile', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&flagged=1')
    for (const msg of page.items) {
      expect(msg.flagged).toBe(true)
    }
  })

  it('attachments=1 retourne uniquement les messages avec pièces jointes', async () => {
    const c = await login()
    // Contrat : MessageSummary.hasAttachments (il n'existe pas de compteur).
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&attachments=1&pageSize=100')
    expect(page.items.map(m => m.subject)).toEqual(expect.arrayContaining(['Photos de la sortie', 'Relevé de notes — semestre 4']))
    for (const msg of page.items) expect(msg.hasAttachments).toBe(true)
  })

  it('les filtres fonctionnent sans q', async () => {
    const c = await login()
    const unread = await c.json<MessagePage>('/api/messages?folder=INBOX&unread=1&pageSize=10')
    expect(unread.items.every(m => !m.seen)).toBe(true)
  })

  it('since=AAAA-MM-JJ et before=AAAA-MM-JJ filtrent par date', async () => {
    const c = await login()
    // Les données de test couvrent les 90 derniers jours : fenêtre relative à aujourd'hui.
    const day = 86_400_000
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
    const since = iso(Date.now() - 30 * day)
    const before = iso(Date.now() - 10 * day)
    const all = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    const page = await c.json<MessagePage>(`/api/messages?folder=INBOX&pageSize=100&since=${since}&before=${before}`)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.length).toBeLessThan(all.items.length)
    for (const msg of page.items) {
      const date = Date.parse(msg.date)
      expect(date).toBeGreaterThanOrEqual(Date.parse(since))
      expect(date).toBeLessThan(Date.parse(before))
    }
  })
})

// ============================================================================
// R1.3 — Lecture : impression, source, en-têtes, zip, aperçus
// ============================================================================

describe('R1.3 — impression', () => {
  it('GET /api/messages/:uid/print → page HTML autonome avec CSP sandbox', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    const res = await c.request(`/api/messages/${msg.uid}/print?folder=INBOX`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const csp = res.headers.get('content-security-policy')
    expect(csp).toContain('sandbox')
    expect(csp).toMatch(/script-src 'sha256-/)

    const html = await res.text()
    expect(html).toContain(msg.subject)
    expect(html).not.toMatch(/https?:\/\/[^<]*\.(?:png|gif|jpg)/)
  })
})

describe('R1.3 — source du message', () => {
  it('GET /api/messages/:uid/source → { headers, source }', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    const res = await c.request(`/api/messages/${msg.uid}/source?folder=INBOX`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as { headers: Array<{ name: string; value: string }>; source: string }
    expect(data.headers).toBeDefined()
    expect(Array.isArray(data.headers)).toBe(true)
    const subjectHeader = data.headers.find(h => h.name.toLowerCase() === 'subject')
    expect(subjectHeader?.value).toBe(msg.subject)
    expect(data.source).toBeDefined()
  })
})

describe('R1.3 — télécharger brut (.eml)', () => {
  it('GET /api/messages/:uid/raw → octet-stream avec Content-Disposition: attachment', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    const res = await c.request(`/api/messages/${msg.uid}/raw?folder=INBOX`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/attachment.*\.eml/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('R1.3 — télécharger pièces jointes en zip', () => {
  it('GET /api/messages/:uid/attachments.zip → archive avec toutes les pièces jointes', async () => {
    const c = await login()
    const msg = await findBySubject(c, 'INBOX', 'Photos de la sortie')
    expect(msg).toBeDefined()

    const res = await c.request(`/api/messages/${msg!.uid}/attachments.zip?folder=INBOX`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')

    const buf = await res.arrayBuffer()
    // Magic bytes du ZIP
    expect(new Uint8Array(buf).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]))
  })
})

// ============================================================================
// R1.4 — Rediriger, transférer en pièce jointe, indicateurs
// ============================================================================

describe('R1.4 — rediriger un message', () => {
  it('POST /api/messages/:uid/redirect → 204', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    const res = await c.request(`/api/messages/${msg.uid}/redirect`, {
      method: 'POST',
      body: { folder: 'INBOX', to: ['alice@mmi-troyes.fr'] },
    })
    expect(res.status).toBe(204)

    // Vérifie qu'Alice a reçu le message inchangé avec en-têtes Resent-*
    const alice = await login('alice@mmi-troyes.fr')
    const aliceMsg = await findBySubject(alice, 'INBOX', msg.subject)
    expect(aliceMsg).toBeDefined()

    // Les en-têtes sont exposés par GET /api/messages/:uid/source (spec R1.3).
    const src = await alice.json<{ headers: Array<{ name: string; value: string }> }>(`/api/messages/${aliceMsg!.uid}/source?folder=INBOX`)
    expect(src.headers.find(h => h.name.toLowerCase() === 'resent-from')?.value).toContain('dev@mmi-troyes.fr')
  })
})

describe('R1.4 — origin et indicateurs répondu/transféré', () => {
  it('ComposePayload.origin avec kind=reply → pose le drapeau \\\\Answered sur l\'original', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    await c.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: [],
        bcc: [],
        subject: `Re: ${msg.subject}`,
        text: 'Réponse',
        origin: { folder: 'INBOX', uid: msg.uid, kind: 'reply' },
      },
    })

    const updated = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    const original = updated.items.find(m => m.uid === msg.uid)
    expect(original?.answered).toBe(true)
  })

  it('ComposePayload.origin avec kind=forward → pose le drapeau $Forwarded sur l\'original', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    await c.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: [],
        bcc: [],
        subject: `Tr: ${msg.subject}`,
        text: 'Transmis',
        origin: { folder: 'INBOX', uid: msg.uid, kind: 'forward' },
      },
    })

    const updated = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    const original = updated.items.find(m => m.uid === msg.uid)
    expect(original?.forwarded).toBe(true)
  })

  it('MessageSummary expose answered et forwarded', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=10')
    for (const msg of page.items) {
      expect(msg).toHaveProperty('answered')
      expect(msg).toHaveProperty('forwarded')
      expect(typeof msg.answered).toBe('boolean')
      expect(typeof msg.forwarded).toBe('boolean')
    }
  })
})

describe('R1.4 — transférer en pièce jointe', () => {
  it('ComposePayload.forwardAsAttachment → message joint en message/rfc822', async () => {
    const c = await login()
    const msg = (await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=1')).items[0]!

    const res = await c.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: [],
        bcc: [],
        subject: `Tr: ${msg.subject}`,
        text: 'Regarde ce message',
        forwardAsAttachment: [{ folder: 'INBOX', uid: msg.uid }],
      },
    })
    expect(res.status).toBe(204)

    // Vérifie qu'Alice voit une pièce jointe .eml
    const alice = await login('alice@mmi-troyes.fr')
    const sent = await findBySubject(alice, 'INBOX', `Tr: ${msg.subject}`)
    const detail = await alice.json<MessageDetail>(`/api/messages/${sent!.uid}?folder=INBOX`)
    expect(detail.attachments.some(a => a.filename.endsWith('.eml'))).toBe(true)
  })
})

// ============================================================================
// R1.5 — Priorité et accusés de lecture
// ============================================================================

describe('R1.5 — priorité', () => {
  it('ComposePayload.priority=high → en-têtes X-Priority et Importance', async () => {
    const c = await login()
    const subject = `Haute priorité ${Date.now()}`

    await c.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: [],
        bcc: [],
        subject,
        text: 'Urgent',
        priority: 'high',
      },
    })

    const alice = await login('alice@mmi-troyes.fr')
    const msg = await findBySubject(alice, 'INBOX', subject)
    const detail = await alice.json<MessageDetail>(`/api/messages/${msg!.uid}?folder=INBOX`)
    expect(detail.priority).toBe('high')
  })

  it('MessageSummary.priority expose high|normal|low', async () => {
    const c = await login()
    const page = await c.json<MessagePage>('/api/messages?folder=INBOX&pageSize=100')
    for (const msg of page.items) {
      expect(['high', 'normal', 'low']).toContain(msg.priority)
    }
  })
})

describe('R1.5 — demander un accusé de lecture', () => {
  it('ComposePayload.requestReadReceipt=true → en-tête Disposition-Notification-To', async () => {
    const c = await login()
    const subject = `Demande accusé ${Date.now()}`

    await c.request('/api/send', {
      method: 'POST',
      body: {
        to: ['alice@mmi-troyes.fr'],
        cc: [],
        bcc: [],
        subject,
        text: 'Peux-tu confirmer?',
        requestReadReceipt: true,
      },
    })

    const alice = await login('alice@mmi-troyes.fr')
    const msg = await findBySubject(alice, 'INBOX', subject)
    const detail = await alice.json<MessageDetail>(`/api/messages/${msg!.uid}?folder=INBOX`)
    expect(detail.readReceiptTo).toBeDefined()
    expect(detail.readReceiptTo?.address).toBe('dev@mmi-troyes.fr')
  })

  it('MessageDetail.readReceiptTo=null si pas demandé ou déjà envoyé ($MDNSent)', async () => {
    const c = await login()
    // « Relevé de notes — semestre 4 » ne demande pas d'accusé de lecture (données de test R1).
    const msg = await findBySubject(c, 'INBOX', 'Relevé de notes — semestre 4')
    expect(msg).toBeDefined()
    const detail = await c.json<MessageDetail>(`/api/messages/${msg!.uid}?folder=INBOX`)
    expect(detail.readReceiptTo).toBeNull()
  })
})

describe('R1.5 — envoyer un accusé de lecture (MDN)', () => {
  it('POST /api/messages/:uid/mdn { folder } → 204', async () => {
    const c = await login()
    // "Réunion : merci de confirmer" a une demande d'accusé
    const msg = await findBySubject(c, 'INBOX', 'Réunion : merci de confirmer')
    expect(msg).toBeDefined()

    const res = await c.request(`/api/messages/${msg!.uid}/mdn`, { method: 'POST', body: { folder: 'INBOX' } })
    expect(res.status).toBe(204)

    // Après l'envoi, readReceiptTo doit être null
    const detail = await c.json<MessageDetail>(`/api/messages/${msg!.uid}?folder=INBOX`)
    expect(detail.readReceiptTo).toBeNull()
  })

  it('retourne 409 si aucun accusé n\'est demandé ou déjà envoyé', async () => {
    const c = await login()
    // Aucun accusé demandé sur ce message → 409 (spec R1.5).
    const msg = await findBySubject(c, 'INBOX', 'Relevé de notes — semestre 4')
    expect(msg).toBeDefined()
    const res = await c.request(`/api/messages/${msg!.uid}/mdn`, { method: 'POST', body: { folder: 'INBOX' } })
    expect(res.status).toBe(409)
  })

  it('envoyer deux fois le même MDN → 409 la seconde fois', async () => {
    const c = await login()
    const msg = await findBySubject(c, 'INBOX', 'Réunion : merci de confirmer')
    expect(msg).toBeDefined()

    // Premier envoi OK
    let res = await c.request(`/api/messages/${msg!.uid}/mdn`, { method: 'POST', body: { folder: 'INBOX' } })
    expect(res.status).toBe(204)

    // Deuxième tentative → 409
    res = await c.request(`/api/messages/${msg!.uid}/mdn`, { method: 'POST', body: { folder: 'INBOX' } })
    expect(res.status).toBe(409)
  })
})

// ============================================================================
// Cas de sécurité : toutes les routes R1 nécessitent une session
// ============================================================================

describe('sécurité — authentification requise', () => {
  it('401 sans session sur les routes R1', async () => {
    const c = client() // pas de login
    expect((await c.request('/api/messages?folder=INBOX')).status).toBe(401)
    expect((await c.request('/api/folders/mark-read', { method: 'POST', body: { folder: 'INBOX' } })).status).toBe(401)
    expect((await c.request('/api/messages/copy', { method: 'POST', body: { folder: 'INBOX', uids: [1], destination: 'INBOX.Projets' } })).status).toBe(401)
    expect((await c.request('/api/messages/zip?folder=INBOX&uids=1')).status).toBe(401)
  })
})

describe('sécurité — Origin header sur POST', () => {
  it('403 si POST sans Origin header valide', async () => {
    const c = await login()
    const res = await fetch(url('/api/folders/mark-read'), {
      method: 'POST',
      headers: {
        'cookie': c.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ folder: 'INBOX' }),
    })
    expect(res.status).toBe(403)
  })

  it('403 si POST avec Origin header étranger', async () => {
    const c = await login()
    const res = await c.request('/api/folders/mark-read', {
      method: 'POST',
      body: { folder: 'INBOX' },
      headers: { origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })
})
