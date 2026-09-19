/**
 * Tests d'intégration de la liste (tri, filtres, recherche par champ, pagination) contre
 * GreenMail (docker compose up -d greenmail). Ignorés automatiquement si GreenMail n'écoute
 * pas sur 127.0.0.1:3143.
 *
 * Couvre la correction de perf/exactitude de ImapBackend.listMessages : le tri, les filtres
 * et la recherche par champ sont désormais appliqués côté IMAP (pas seulement dans le mock),
 * et la prévisualisation n'est jamais récupérée pour plus d'une page de résultats.
 */
import net from 'node:net'
import { ImapFlow } from 'imapflow'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComposePayload } from '#shared/types/mail'
import type { MailServerConfig } from '../../server/lib/mail/backend'
import { buildRawMessage } from '../../server/lib/mail/compose'
import { ImapBackend } from '../../server/lib/mail/imap'

const config: MailServerConfig = { host: '127.0.0.1', imapPort: 3143, imapSecure: false, smtpPort: 3025, smtpRequireTls: false }
const dev = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(3143, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

const folder = `LIST-${Date.now()}`
const TOTAL = 300
/** Marqueur présent uniquement dans le corps d'un message, jamais dans son sujet. */
const BODY_ONLY_MARKER = 'ZQXBODYONLYMARKER'

async function raw(subject: string, extra: Partial<ComposePayload> = {}): Promise<Buffer> {
  return buildRawMessage('bob@mmi-troyes.fr', { to: [dev.email], cc: [], bcc: [], subject, text: `Corps de ${subject}`, ...extra })
}

describe.skipIf(!reachable)('ImapBackend.listMessages against GreenMail — tri, filtres, recherche', () => {
  let backend: ImapBackend

  beforeAll(async () => {
    const admin = new ImapFlow({ host: '127.0.0.1', port: 3143, secure: false, auth: { user: dev.email, pass: dev.password }, logger: false })
    await admin.connect()
    await admin.mailboxCreate(folder)
    await admin.logout()

    backend = new ImapBackend(dev, config)
    // Sujets triables lexicalement ("Msg 001".."Msg 300") ; un message sur trois non lu.
    for (let i = 1; i <= TOTAL; i++) {
      const padded = String(i).padStart(3, '0')
      const flags = i % 3 === 0 ? [] : ['\\Seen']
      await backend.append(folder, await raw(`Msg ${padded}`), flags)
    }
    // Message dont le marqueur n'apparaît que dans le corps, jamais dans le sujet — sert à
    // vérifier qu'une recherche restreinte à `fields: ['subject']` ne le trouve pas.
    await backend.append(folder, await buildRawMessage('bob@mmi-troyes.fr', {
      to: [dev.email],
      cc: [],
      bcc: [],
      subject: 'Rapport ordinaire',
      text: `Ce message contient ${BODY_ONLY_MARKER} uniquement dans son corps.`,
    }), ['\\Seen'])
  }, 180_000)

  afterAll(async () => {
    await backend?.close()
  })

  it('page 2 renvoie la bonne tranche (tri date décroissant par défaut, sans chevauchement)', async () => {
    const page1 = await backend.listMessages(folder, { page: 1, pageSize: 50 })
    const page2 = await backend.listMessages(folder, { page: 2, pageSize: 50 })

    expect(page1.total).toBe(TOTAL + 1)
    expect(page2.total).toBe(TOTAL + 1)
    expect(page1.items).toHaveLength(50)
    expect(page2.items).toHaveLength(50)

    // Le dernier message ajouté (Rapport ordinaire) est le plus récent : page 1 commence par lui,
    // puis Msg 300 en ordre décroissant d'arrivée.
    expect(page1.items[0]?.subject).toBe('Rapport ordinaire')
    expect(page1.items[1]?.subject).toBe('Msg 300')
    expect(page1.items[49]?.subject).toBe('Msg 252')
    expect(page2.items[0]?.subject).toBe('Msg 251')
    expect(page2.items[49]?.subject).toBe('Msg 202')

    const uidsPage1 = new Set(page1.items.map(m => m.uid))
    for (const item of page2.items) expect(uidsPage1.has(item.uid)).toBe(false)
  })

  it('sort=subject order=asc trie l\'ensemble des messages, pas seulement la page demandée', async () => {
    const page = await backend.listMessages(folder, { page: 1, pageSize: 5, sort: 'subject', order: 'asc' })
    expect(page.total).toBe(TOTAL + 1)
    expect(page.items.map(m => m.subject)).toEqual(['Msg 001', 'Msg 002', 'Msg 003', 'Msg 004', 'Msg 005'])

    const lastPage = await backend.listMessages(folder, { page: 1, pageSize: 1, sort: 'subject', order: 'desc' })
    expect(lastPage.items.map(m => m.subject)).toEqual(['Rapport ordinaire'])
  })

  it('filters.unread ne renvoie que les messages non lus', async () => {
    const page = await backend.listMessages(folder, { page: 1, pageSize: 150, filters: { unread: true } })
    // Un message sur trois parmi les 300 (i % 3 === 0) est non lu ; le message « Rapport
    // ordinaire » a été ajouté avec \Seen.
    expect(page.total).toBe(100)
    expect(page.items).toHaveLength(100)
    expect(page.items.every(m => !m.seen)).toBe(true)
  })

  it('la recherche restreinte à fields: [\'subject\'] ne trouve pas un terme présent seulement dans le corps', async () => {
    const restricted = await backend.listMessages(folder, { page: 1, pageSize: 10, query: BODY_ONLY_MARKER, fields: ['subject'] })
    expect(restricted.items).toEqual([])

    const unrestricted = await backend.listMessages(folder, { page: 1, pageSize: 10, query: BODY_ONLY_MARKER })
    expect(unrestricted.items.map(m => m.subject)).toEqual(['Rapport ordinaire'])
  })

  it('la recherche dans le champ objet trouve un sujet précis sans confondre avec le corps', async () => {
    const page = await backend.listMessages(folder, { page: 1, pageSize: 10, query: 'Msg 042', fields: ['subject'] })
    expect(page.items.map(m => m.subject)).toEqual(['Msg 042'])
  })

  it('recherche combinant plusieurs champs (OR) sans planter le serveur', async () => {
    const page = await backend.listMessages(folder, { page: 1, pageSize: 10, query: 'Msg 099', fields: ['subject', 'from', 'to'] })
    expect(page.items.map(m => m.subject)).toEqual(['Msg 099'])
  })

  it('ne récupère les aperçus (fetchPreviews) que pour la page demandée, jamais pour les 301 messages', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(backend as any, 'fetchPreviews')
    try {
      const page = await backend.listMessages(folder, { page: 1, pageSize: 50, sort: 'subject', order: 'asc' })
      expect(page.items).toHaveLength(50)
      // Un seul appel, portant sur au plus une page de messages — même si sort=subject a dû
      // récupérer un attribut léger (envelope) pour les 301 messages avant de paginer.
      expect(spy).toHaveBeenCalledTimes(1)
      const messagesArg = spy.mock.calls[0]?.[1] as unknown[]
      expect(messagesArg.length).toBeLessThanOrEqual(50)
    }
    finally {
      spy.mockRestore()
    }
  })
})
