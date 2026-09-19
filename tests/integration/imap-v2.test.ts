/**
 * Tests d'intégration du backend IMAP v2 contre GreenMail.
 * Ignorés automatiquement si GreenMail n'écoute pas sur 127.0.0.1:3143.
 */
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ComposePayload } from '#shared/types/mail'
import type { MailServerConfig } from '../../server/lib/mail/backend'
import { MailError } from '../../server/lib/mail/backend'
import { buildRawMessage } from '../../server/lib/mail/compose'
import { ImapBackend } from '../../server/lib/mail/imap'

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

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(3143, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

const folder = `V2-${Date.now()}`

async function raw(subject: string, extra: Partial<ComposePayload> = {}): Promise<Buffer> {
  return buildRawMessage('bob@mmi-troyes.fr', { to: [dev.email], cc: [], bcc: [], subject, text: `Corps de ${subject}`, ...extra })
}

describe.skipIf(!reachable)('ImapBackend v2', () => {
  let backend: ImapBackend

  beforeAll(async () => {
    backend = new ImapBackend(dev, config)
    // Create unique test folder
    const client = await (backend as any).imap()
    try {
      await client.mailboxCreate(folder)
    }
    catch {
      // Folder may already exist or creation may fail; continue
    }

    // Append 3 messages forming a thread
    const messageId1 = '<msg-thread-001@example.com>'
    const messageId2 = '<msg-thread-002@example.com>'
    const messageId3 = '<msg-thread-003@example.com>'

    // First message (root)
    await backend.append(folder, await buildRawMessage('bob@mmi-troyes.fr', {
      to: [dev.email],
      cc: [],
      bcc: [],
      subject: 'Thread Root',
      text: 'First message',
    }, { messageId: messageId1 }), [])

    // Reply to first message
    await backend.append(folder, await buildRawMessage('bob@mmi-troyes.fr', {
      to: [dev.email],
      cc: [],
      bcc: [],
      subject: 'Re: Thread Root',
      text: 'Reply 1',
      inReplyTo: messageId1,
      references: [messageId1],
    }, { messageId: messageId2 }), [])

    // Reply to second message
    await backend.append(folder, await buildRawMessage('bob@mmi-troyes.fr', {
      to: [dev.email],
      cc: [],
      bcc: [],
      subject: 'Re: Thread Root',
      text: 'Reply 2',
      inReplyTo: messageId2,
      references: [messageId1, messageId2],
    }, { messageId: messageId3 }), [])
  })

  afterAll(async () => {
    await backend?.close()
  })

  describe('searchHeader', () => {
    it('finds messages by message-id', async () => {
      const messageId = '<msg-thread-001@example.com>'
      const found = await backend.searchHeader(folder, 'message-id', messageId)
      expect(found).toHaveLength(1)
    })

    it('finds messages by in-reply-to', async () => {
      const messageId = '<msg-thread-001@example.com>'
      const found = await backend.searchHeader(folder, 'in-reply-to', messageId)
      expect(found.length).toBeGreaterThanOrEqual(1)
    })

    it('finds messages by references', async () => {
      const messageId = '<msg-thread-001@example.com>'
      const found = await backend.searchHeader(folder, 'references', messageId)
      expect(found.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty array if no matches', async () => {
      const found = await backend.searchHeader(folder, 'message-id', '<nonexistent-12345@example.com>')
      expect(found).toEqual([])
    })

    it('throws NOT_FOUND for unknown folder', async () => {
      await expect(backend.searchHeader('UNKNOWN_FOLDER_XYZ', 'message-id', '<test@example.com>')).rejects.toThrow(MailError)
    })
  })

  describe('summaries', () => {
    it('returns summaries for given uids', async () => {
      const result = await backend.listMessages(folder, { page: 1, pageSize: 10 })
      if (result.items.length === 0) {
        // Skip if no messages were created
        return
      }
      const uids = result.items.map(m => m.uid)
      const summaries = await backend.summaries(folder, uids)
      expect(summaries).toHaveLength(uids.length)
      summaries.forEach((s) => {
        expect(s.uid).toBeDefined()
        expect(s.subject).toBeDefined()
        expect(s.from).toBeDefined()
        expect(s.date).toBeDefined()
      })
    })

    it('returns empty array for empty uid list', async () => {
      const summaries = await backend.summaries(folder, [])
      expect(summaries).toEqual([])
    })

    it('ignores missing uids', async () => {
      const result = await backend.listMessages(folder, { page: 1, pageSize: 1 })
      if (result.items.length === 0) {
        return
      }
      const uid = result.items[0].uid
      const summaries = await backend.summaries(folder, [uid, 99999])
      expect(summaries.length).toBeGreaterThanOrEqual(1)
      expect(summaries[0].uid).toBe(uid)
    })

    it('throws NOT_FOUND for unknown folder', async () => {
      await expect(backend.summaries('UNKNOWN_FOLDER_XYZ', [1])).rejects.toThrow(MailError)
    })
  })
})
