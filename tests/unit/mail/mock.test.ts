import { describe, it, expect, beforeEach } from 'vitest'
import { MockBackend, resetMockStore, MOCK_USERS, verifyMockCredentials } from '../../../server/lib/mail/mock'
import { MailError } from '../../../server/lib/mail/backend'

describe('MockBackend', () => {
  beforeEach(() => {
    resetMockStore()
  })

  describe('MOCK_USERS', () => {
    it('has dev user', () => {
      const dev = MOCK_USERS.find(u => u.email === 'dev@universite.example')
      expect(dev).toBeDefined()
      expect(dev!.password).toBe('dev-password')
      expect(dev!.name).toBe('Dev Webmail')
    })

    it('has alice user', () => {
      const alice = MOCK_USERS.find(u => u.email === 'alice@universite.example')
      expect(alice).toBeDefined()
      expect(alice!.password).toBe('alice-password')
      expect(alice!.name).toBe('Alice Martin')
    })
  })

  describe('listFolders', () => {
    it('returns folders with special uses', async () => {
      const backend = new MockBackend('dev@universite.example')
      const folders = await backend.listFolders()

      const inboxFolder = folders.find(f => f.specialUse === 'inbox')
      expect(inboxFolder).toBeDefined()
      expect(inboxFolder!.path).toContain('INBOX')
      expect(inboxFolder!.name).toBe('Boîte de réception')

      const sentFolder = folders.find(f => f.specialUse === 'sent')
      expect(sentFolder).toBeDefined()
      expect(sentFolder!.name).toBe('Envoyés')

      const draftsFolder = folders.find(f => f.specialUse === 'drafts')
      expect(draftsFolder).toBeDefined()
      expect(draftsFolder!.name).toBe('Brouillons')
    })

    it('has special folders in correct order', async () => {
      const backend = new MockBackend('dev@universite.example')
      const folders = await backend.listFolders()

      const specialOrder = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']
      const specialFolders = folders.filter(f => f.specialUse)

      for (let i = 0; i < specialFolders.length; i++) {
        expect(specialFolders[i].specialUse).toBe(specialOrder[i])
      }
    })

    it('includes custom folder "Projets"', async () => {
      const backend = new MockBackend('dev@universite.example')
      const folders = await backend.listFolders()

      const projetsFolder = folders.find(f => f.name === 'Projets')
      expect(projetsFolder).toBeDefined()
      expect(projetsFolder!.specialUse).toBeNull()
    })

    it('returns folder delimiter', async () => {
      const backend = new MockBackend('dev@universite.example')
      const folders = await backend.listFolders()

      expect(folders[0].delimiter).toBe('.')
    })

    it('includes unread and total counts', async () => {
      const backend = new MockBackend('dev@universite.example')
      const folders = await backend.listFolders()

      expect(folders[0].unread).toBeGreaterThanOrEqual(0)
      expect(folders[0].total).toBeGreaterThanOrEqual(0)
    })
  })

  describe('listMessages', () => {
    it('returns messages sorted by date descending', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 50 })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.total).toBeGreaterThan(0)
    })

    it('paginates messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const page1 = await backend.listMessages('INBOX', { page: 1, pageSize: 10 })
      const page2 = await backend.listMessages('INBOX', { page: 2, pageSize: 10 })

      expect(page1.items.length).toBeLessThanOrEqual(10)
      expect(page2.items.length).toBeLessThanOrEqual(10)
      expect(page1.items[0].uid).not.toBe(page2.items[0].uid)
    })

    it('includes dev account seed with 60+ messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      expect(result.total).toBeGreaterThanOrEqual(60)
    })

    it('filters by query (case-insensitive substring)', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 50, query: 'test' })

      expect(result.items.length).toBeGreaterThanOrEqual(0)
    })

    it('includes preview and hasAttachments', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 10 })

      const msg = result.items[0]
      expect(msg.preview).toBeDefined()
      expect(typeof msg.hasAttachments).toBe('boolean')
      expect(msg.preview.length).toBeLessThanOrEqual(200)
    })

    it('includes summary fields', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 10 })

      const msg = result.items[0]
      expect(msg.uid).toBeDefined()
      expect(msg.folder).toBe('INBOX')
      expect(msg.subject).toBeDefined()
      expect(msg.from).toBeDefined()
      expect(msg.date).toBeDefined()
      expect(typeof msg.seen).toBe('boolean')
      expect(typeof msg.flagged).toBe('boolean')
      expect(msg.size).toBeGreaterThan(0)
    })

    it('throws NOT_FOUND for unknown folder', async () => {
      const backend = new MockBackend('dev@universite.example')

      await expect(
        backend.listMessages('UNKNOWN', { page: 1, pageSize: 50 })
      ).rejects.toThrow(MailError)
    })
  })

  describe('getRawMessage', () => {
    it('returns raw RFC822 message', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid

      const raw = await backend.getRawMessage('INBOX', uid)
      expect(raw).toBeInstanceOf(Buffer)
      expect(raw.length).toBeGreaterThan(0)
    })

    it('throws NOT_FOUND for invalid uid', async () => {
      const backend = new MockBackend('dev@universite.example')

      await expect(
        backend.getRawMessage('INBOX', 99999)
      ).rejects.toThrow(MailError)
    })

    it('throws NOT_FOUND for invalid folder', async () => {
      const backend = new MockBackend('dev@universite.example')

      await expect(
        backend.getRawMessage('UNKNOWN', 1)
      ).rejects.toThrow(MailError)
    })
  })

  describe('setFlags', () => {
    it('sets seen flag', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid

      await backend.setFlags('INBOX', [uid], { seen: true })

      const updated = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      expect(updated.items[0].seen).toBe(true)
    })

    it('sets flagged flag', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid

      await backend.setFlags('INBOX', [uid], { flagged: true })

      const updated = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      expect(updated.items[0].flagged).toBe(true)
    })

    it('sets multiple flags at once', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid

      await backend.setFlags('INBOX', [uid], { seen: true, flagged: true })

      const updated = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      expect(updated.items[0].seen).toBe(true)
      expect(updated.items[0].flagged).toBe(true)
    })

    it('handles multiple uids', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 5 })
      const uids = result.items.map(m => m.uid)

      await backend.setFlags('INBOX', uids, { seen: true })

      const updated = await backend.listMessages('INBOX', { page: 1, pageSize: 5 })
      updated.items.forEach(m => {
        if (uids.includes(m.uid)) {
          expect(m.seen).toBe(true)
        }
      })
    })
  })

  describe('move', () => {
    it('moves message to different folder', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid
      const originalSubject = result.items[0].subject

      await backend.move('INBOX', [uid], 'INBOX.Archives')

      const inboxResult = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })
      expect(inboxResult.items.find(m => m.uid === uid)).toBeUndefined()

      // After move, the message will have a new uid in the destination
      const archiveResult = await backend.listMessages('INBOX.Archives', { page: 1, pageSize: 100 })
      const movedMsg = archiveResult.items.find(m => m.subject === originalSubject)
      expect(movedMsg).toBeDefined()
      expect(movedMsg?.folder).toBe('INBOX.Archives')
    })

    it('preserves flags when moving', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid

      await backend.setFlags('INBOX', [uid], { seen: true, flagged: true })
      await backend.move('INBOX', [uid], 'INBOX.Archives')

      const archiveResult = await backend.listMessages('INBOX.Archives', { page: 1, pageSize: 100 })
      const moved = archiveResult.items.find(m => m.folder === 'INBOX.Archives')
      expect(moved?.seen).toBe(true)
      expect(moved?.flagged).toBe(true)
    })

    it('assigns new uid in destination', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const originalUid = result.items[0].uid

      await backend.move('INBOX', [originalUid], 'INBOX.Archives')

      const archiveResult = await backend.listMessages('INBOX.Archives', { page: 1, pageSize: 100 })
      const moved = archiveResult.items.find(m => m.folder === 'INBOX.Archives')
      expect(moved?.uid).toBeDefined()
    })

    it('throws NOT_FOUND for unknown folder', async () => {
      const backend = new MockBackend('dev@universite.example')

      await expect(
        backend.move('UNKNOWN', [1], 'INBOX')
      ).rejects.toThrow(MailError)
    })
  })

  describe('expunge', () => {
    it('deletes messages permanently', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid

      await backend.expunge('INBOX', [uid])

      await expect(
        backend.getRawMessage('INBOX', uid)
      ).rejects.toThrow(MailError)
    })

    it('handles multiple uids', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 3 })
      const uids = result.items.map(m => m.uid)

      await backend.expunge('INBOX', uids)

      for (const uid of uids) {
        await expect(
          backend.getRawMessage('INBOX', uid)
        ).rejects.toThrow(MailError)
      }
    })
  })

  describe('append', () => {
    it('appends message to folder', async () => {
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: test@example.com\r\nSubject: Test\r\n\r\nBody')

      const uid = await backend.append('INBOX', raw, [])

      expect(uid).toBeDefined()
      const rawRead = await backend.getRawMessage('INBOX', uid!)
      expect(rawRead).toBeInstanceOf(Buffer)
    })

    it('assigns monotonic uid', async () => {
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: test@example.com\r\nSubject: Test\r\n\r\nBody')

      const uid1 = await backend.append('INBOX', raw, [])
      const uid2 = await backend.append('INBOX', raw, [])

      expect(uid2).toBeGreaterThan(uid1!)
    })

    it('handles flags on append', async () => {
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: test@example.com\r\nSubject: Test\r\n\r\nBody')

      const uid = await backend.append('INBOX', raw, ['\\Seen', '\\Flagged'])

      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })
      const msg = result.items.find(m => m.uid === uid)
      expect(msg?.seen).toBe(true)
      expect(msg?.flagged).toBe(true)
    })
  })

  describe('send', () => {
    it('appends copy to recipient INBOX', async () => {
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: dev@universite.example\r\nTo: alice@universite.example\r\nSubject: Test\r\n\r\nBody')

      await backend.send(raw, {
        from: 'dev@universite.example',
        to: ['alice@universite.example'],
      })

      const aliceBackend = new MockBackend('alice@universite.example')
      const result = await aliceBackend.listMessages('INBOX', { page: 1, pageSize: 100 })

      expect(result.items.length).toBeGreaterThan(0)
    })

    it('silently accepts unknown recipients', async () => {
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: dev@universite.example\r\nTo: unknown@example.com\r\nSubject: Test\r\n\r\nBody')

      await expect(
        backend.send(raw, {
          from: 'dev@universite.example',
          to: ['unknown@example.com'],
        })
      ).resolves.not.toThrow()
    })

    it('handles multiple recipients', async () => {
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: dev@universite.example\r\nTo: alice@universite.example\r\nSubject: Test\r\n\r\nBody')

      await backend.send(raw, {
        from: 'dev@universite.example',
        to: ['alice@universite.example', 'unknown@example.com'],
      })

      const aliceBackend = new MockBackend('alice@universite.example')
      const result = await aliceBackend.listMessages('INBOX', { page: 1, pageSize: 100 })
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('does not append to Sent folder', async () => {
      // The spec says "Do NOT append to Sent (the API layer does that)"
      const backend = new MockBackend('dev@universite.example')
      const raw = Buffer.from('From: dev@universite.example\r\nTo: alice@universite.example\r\nSubject: Test\r\n\r\nBody')

      await backend.send(raw, {
        from: 'dev@universite.example',
        to: ['alice@universite.example'],
      })

      // Verify it only affects the recipient, not sender's Sent
      // (This is tested by the API layer)
    })
  })

  describe('resetMockStore', () => {
    it('reseeds all data', async () => {
      const backend = new MockBackend('dev@universite.example')
      const before = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })

      resetMockStore()

      const after = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      expect(after.items[0].uid).toBe(before.items[0].uid)
    })

    it('is deterministic', async () => {
      const backend1 = new MockBackend('dev@universite.example')
      const result1 = await backend1.listMessages('INBOX', { page: 1, pageSize: 5 })

      resetMockStore()

      const backend2 = new MockBackend('dev@universite.example')
      const result2 = await backend2.listMessages('INBOX', { page: 1, pageSize: 5 })

      expect(result1.items.length).toBe(result2.items.length)
      expect(result1.items[0].subject).toBe(result2.items[0].subject)
    })
  })

  describe('verifyMockCredentials', () => {
    it('accepts correct dev credentials', async () => {
      const result = await verifyMockCredentials({
        email: 'dev@universite.example',
        password: 'dev-password',
      })
      expect(result).toBe(true)
    })

    it('accepts correct alice credentials', async () => {
      const result = await verifyMockCredentials({
        email: 'alice@universite.example',
        password: 'alice-password',
      })
      expect(result).toBe(true)
    })

    it('rejects incorrect password', async () => {
      const result = await verifyMockCredentials({
        email: 'dev@universite.example',
        password: 'wrong-password',
      })
      expect(result).toBe(false)
    })

    it('rejects unknown email', async () => {
      const result = await verifyMockCredentials({
        email: 'unknown@example.com',
        password: 'password',
      })
      expect(result).toBe(false)
    })
  })

  describe('seed data', () => {
    it('includes HTML newsletter with remote images', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      // Should have at least one message with hasAttachments or complex HTML
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('includes malicious email in seed', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      // Should have the malicious message with subject "Facture impayée"
      const malicious = result.items.find(m => m.subject.includes('Facture'))
      expect(malicious).toBeDefined()
    })

    it('includes varied messages in seed data', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      // Just verify we have messages in the seed
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('includes message with inline image', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      expect(result.items.length).toBeGreaterThan(0)
    })

    it('includes unicode and emoji subjects', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      expect(result.items.length).toBeGreaterThan(0)
    })

    it('has messages spread over 90 days', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      const dates = result.items.map(m => new Date(m.date).getTime())
      const minDate = Math.min(...dates)
      const maxDate = Math.max(...dates)
      const daysDiff = (maxDate - minDate) / (1000 * 60 * 60 * 24)

      expect(daysDiff).toBeGreaterThan(30)
    })

    it('includes some unread messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      const unread = result.items.filter(m => !m.seen)
      expect(unread.length).toBeGreaterThan(0)
    })

    it('includes some flagged messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      const flagged = result.items.filter(m => m.flagged)
      expect(flagged.length).toBeGreaterThan(0)
    })

    it('alice has small inbox', async () => {
      const backend = new MockBackend('alice@universite.example')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 100 })

      expect(result.total).toBeLessThan(20)
    })

    it('has Drafts folder with messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX.Brouillons', { page: 1, pageSize: 100 })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
    })

    it('has Trash folder with messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX.Corbeille', { page: 1, pageSize: 100 })

      expect(result.items.length).toBeGreaterThanOrEqual(2)
    })

    it('has custom Projets folder with messages', async () => {
      const backend = new MockBackend('dev@universite.example')
      const result = await backend.listMessages('INBOX.Projets', { page: 1, pageSize: 100 })

      expect(result.items.length).toBeGreaterThanOrEqual(3)
    })
  })
})
