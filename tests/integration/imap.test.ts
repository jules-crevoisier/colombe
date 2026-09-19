/**
 * Tests d'intégration du backend IMAP contre GreenMail (docker compose up -d greenmail).
 * Ignorés automatiquement si GreenMail n'écoute pas sur 127.0.0.1:3143.
 */
import net from 'node:net'
import { ImapFlow } from 'imapflow'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ComposePayload } from '#shared/types/mail'
import type { MailServerConfig } from '../../server/lib/mail/backend'
import { MailError } from '../../server/lib/mail/backend'
import { buildRawMessage } from '../../server/lib/mail/compose'
import { ImapBackend, verifyImapCredentials } from '../../server/lib/mail/imap'
import { parseMessage } from '../../server/lib/mail/parse'

const config: MailServerConfig = {
  imapHost: '127.0.0.1',
  imapPort: 3143,
  imapSecure: false,
  imapServername: '127.0.0.1',
  smtpHost: '127.0.0.1',
  smtpPort: 3025,
  smtpSecure: false,
  smtpRequireTls: false,
  smtpServername: '127.0.0.1',
  loginUsername: 'email',
}
const dev = { email: 'dev@mmi-troyes.fr', password: 'dev-password' }
const alice = { email: 'alice@mmi-troyes.fr', password: 'alice-password' }

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(3143, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

const folder = `IT-${Date.now()}`

async function raw(subject: string, extra: Partial<ComposePayload> = {}): Promise<Buffer> {
  return buildRawMessage('bob@mmi-troyes.fr', { to: [dev.email], cc: [], bcc: [], subject, text: `Corps de ${subject}`, ...extra })
}

describe.skipIf(!reachable)('ImapBackend against GreenMail', () => {
  let backend: ImapBackend

  beforeAll(async () => {
    const admin = new ImapFlow({ host: '127.0.0.1', port: 3143, secure: false, auth: { user: dev.email, pass: dev.password }, logger: false })
    await admin.connect()
    await admin.mailboxCreate(folder)
    await admin.logout()
    backend = new ImapBackend(dev, config)
    for (let i = 1; i <= 7; i++) {
      const extra: Partial<ComposePayload> = i === 7
        ? { attachments: [{ filename: 'rapport.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4').toString('base64') }] }
        : {}
      await backend.append(folder, await raw(`Message ${i}`, extra), i <= 2 ? ['\\Seen'] : [])
    }
  })

  afterAll(async () => {
    await backend?.close()
  })

  it('should accept valid credentials and reject a wrong password', async () => {
    expect(await verifyImapCredentials(dev, config)).toBe(true)
    expect(await verifyImapCredentials({ ...dev, password: 'nope' }, config)).toBe(false)
  })

  it('should report UNAVAILABLE rather than a bad password when the server is down', async () => {
    await expect(verifyImapCredentials(dev, { ...config, imapPort: 1 })).rejects.toBeInstanceOf(MailError)
  })

  it('should list folders with the special folders created when missing', async () => {
    const folders = await backend.listFolders()
    const uses = folders.map(f => f.specialUse)
    for (const use of ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'] as const) expect(uses).toContain(use)
    expect(folders.find(f => f.specialUse === 'inbox')?.name).toBe('Boîte de réception')
    expect(folders.find(f => f.path === folder)).toMatchObject({ total: 7, unread: 5, specialUse: null })
  })

  it('should list newest first with pagination and a text preview', async () => {
    const page1 = await backend.listMessages(folder, { page: 1, pageSize: 5 })
    expect(page1.total).toBe(7)
    expect(page1.items.map(m => m.subject)).toEqual(['Message 7', 'Message 6', 'Message 5', 'Message 4', 'Message 3'])
    expect(page1.items[0]).toMatchObject({ hasAttachments: true, seen: false, folder })
    expect(page1.items[0]?.preview).toContain('Corps de Message 7')
    expect(page1.items[0]?.from?.address).toBe('bob@mmi-troyes.fr')
    const page2 = await backend.listMessages(folder, { page: 2, pageSize: 5 })
    expect(page2.items.map(m => m.subject)).toEqual(['Message 2', 'Message 1'])
    expect(page2.items[0]?.seen).toBe(true)
  })

  it('should search subject and body', async () => {
    const bySubject = await backend.listMessages(folder, { page: 1, pageSize: 50, query: 'Message 3' })
    expect(bySubject.items.map(m => m.subject)).toEqual(['Message 3'])
    const byBody = await backend.listMessages(folder, { page: 1, pageSize: 50, query: 'Corps de Message 4' })
    expect(byBody.items.map(m => m.subject)).toEqual(['Message 4'])
  })

  it('should fetch the raw message and its flags', async () => {
    const { items } = await backend.listMessages(folder, { page: 1, pageSize: 1 })
    const uid = items[0]!.uid
    const detail = await parseMessage(await backend.getRawMessage(folder, uid), { uid, folder, seen: false, flagged: false, size: 0 })
    expect(detail.subject).toBe('Message 7')
    expect(detail.attachments.map(a => a.filename)).toEqual(['rapport.pdf'])
    const msg = await backend.getMessage(folder, uid)
    expect(msg).toMatchObject({ seen: false, flagged: false })
    expect(msg.raw.length).toBeGreaterThan(0)
  })

  it('should set and clear flags', async () => {
    const { items } = await backend.listMessages(folder, { page: 1, pageSize: 1 })
    const uid = items[0]!.uid
    await backend.setFlags(folder, [uid], { seen: true, flagged: true })
    expect(await backend.getMessage(folder, uid)).toMatchObject({ seen: true, flagged: true })
    await backend.setFlags(folder, [uid], { flagged: false })
    expect(await backend.getMessage(folder, uid)).toMatchObject({ seen: true, flagged: false })
  })

  it('should move, append and expunge', async () => {
    const archive = (await backend.listFolders()).find(f => f.specialUse === 'archive')!.path
    const { items } = await backend.listMessages(folder, { page: 2, pageSize: 5 })
    await backend.move(folder, [items[1]!.uid], archive)
    expect((await backend.listMessages(folder, { page: 1, pageSize: 50 })).total).toBe(6)
    const uid = await backend.append(folder, await raw('Temporaire'), ['\\Seen'])
    expect(uid).toBeGreaterThan(0)
    await backend.expunge(folder, [uid!])
    await expect(backend.getRawMessage(folder, uid!)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('should map unknown folders and uids to NOT_FOUND', async () => {
    await expect(backend.listMessages('Nexiste-pas', { page: 1, pageSize: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(backend.getRawMessage(folder, 999999)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('should send over SMTP so that the recipient receives it', async () => {
    const subject = `SMTP ${Date.now()}`
    const message = await buildRawMessage(dev.email, { to: [alice.email], cc: [], bcc: [], subject, text: 'Coucou Alice' })
    await backend.send(message, { from: dev.email, to: [alice.email] })
    const aliceBackend = new ImapBackend(alice, config)
    try {
      let found = false
      for (let i = 0; i < 20 && !found; i++) {
        const { items } = await aliceBackend.listMessages('INBOX', { page: 1, pageSize: 20, query: subject })
        found = items.some(m => m.subject === subject)
        if (!found) await new Promise(resolve => setTimeout(resolve, 250))
      }
      expect(found).toBe(true)
    }
    finally {
      await aliceBackend.close()
    }
  })
})
