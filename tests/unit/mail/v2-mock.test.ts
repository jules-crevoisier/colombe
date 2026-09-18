import { describe, it, expect, beforeEach } from 'vitest'
import { MockBackend, resetMockStore } from '../../../server/lib/mail/mock'
import { MailError } from '../../../server/lib/mail/backend'
import { onMailboxChange } from '../../../server/lib/live/bus'

describe('MockBackend v2', () => {
  beforeEach(() => {
    resetMockStore()
  })

  describe('createFolder', () => {
    it('creates a new folder', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.TestFolder')
      const folders = await backend.listFolders()
      expect(folders.find(f => f.path === 'INBOX.TestFolder')).toBeDefined()
    })

    it('throws INVALID if folder already exists', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.NewFolder')
      await expect(backend.createFolder('INBOX.NewFolder')).rejects.toThrow(MailError)
    })

    it('throws INVALID if name is empty', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.createFolder('INBOX.')).rejects.toThrow(MailError)
    })

    it('throws INVALID if path starts or ends with delimiter', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.createFolder('.TestFolder')).rejects.toThrow(MailError)
      await expect(backend.createFolder('TestFolder.')).rejects.toThrow(MailError)
    })

    it('publishes mailbox change event', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      let changeReceived = false
      const unsub = onMailboxChange('dev@mmi-troyes.fr', (change) => {
        if (change.folder === 'INBOX.NewFolder') {
          changeReceived = true
        }
      })
      try {
        await backend.createFolder('INBOX.NewFolder')
        expect(changeReceived).toBe(true)
      }
      finally {
        unsub()
      }
    })
  })

  describe('renameFolder', () => {
    it('renames an existing folder', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.OldName')
      await backend.renameFolder('INBOX.OldName', 'INBOX.NewName')
      const folders = await backend.listFolders()
      expect(folders.find(f => f.path === 'INBOX.NewName')).toBeDefined()
      expect(folders.find(f => f.path === 'INBOX.OldName')).toBeUndefined()
    })

    it('throws NOT_FOUND if source folder does not exist', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.renameFolder('INBOX.NonExistent', 'INBOX.NewName')).rejects.toThrow(MailError)
    })

    it('throws INVALID if destination already exists', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.Folder1')
      await backend.createFolder('INBOX.Folder2')
      await expect(backend.renameFolder('INBOX.Folder1', 'INBOX.Folder2')).rejects.toThrow(MailError)
    })

    it('throws INVALID if renaming INBOX', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.renameFolder('INBOX', 'MyInbox')).rejects.toThrow(MailError)
    })

    it('throws INVALID if renaming special-use folders', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.renameFolder('INBOX.Envoyés', 'INBOX.OldSent')).rejects.toThrow(MailError)
      await expect(backend.renameFolder('INBOX.Brouillons', 'INBOX.OldDrafts')).rejects.toThrow(MailError)
      await expect(backend.renameFolder('INBOX.Corbeille', 'INBOX.OldTrash')).rejects.toThrow(MailError)
      await expect(backend.renameFolder('INBOX.Spam', 'INBOX.OldJunk')).rejects.toThrow(MailError)
      await expect(backend.renameFolder('INBOX.Archives', 'INBOX.OldArchive')).rejects.toThrow(MailError)
    })

    it('preserves messages when renaming', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const raw = Buffer.from('From: test@example.com\r\nSubject: Test\r\n\r\nBody')
      await backend.createFolder('INBOX.OldName')
      const uid = await backend.append('INBOX.OldName', raw, [])
      await backend.renameFolder('INBOX.OldName', 'INBOX.NewName')
      const msg = await backend.getRawMessage('INBOX.NewName', uid!)
      expect(msg).toBeInstanceOf(Buffer)
    })

    it('publishes mailbox change events', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.OldName')
      let changeCount = 0
      const unsub = onMailboxChange('dev@mmi-troyes.fr', () => {
        changeCount++
      })
      try {
        await backend.renameFolder('INBOX.OldName', 'INBOX.NewName')
        expect(changeCount).toBeGreaterThan(0)
      }
      finally {
        unsub()
      }
    })
  })

  describe('deleteFolder', () => {
    it('deletes an empty folder', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.ToDelete')
      await backend.deleteFolder('INBOX.ToDelete')
      const folders = await backend.listFolders()
      expect(folders.find(f => f.path === 'INBOX.ToDelete')).toBeUndefined()
    })

    it('deletes a folder with messages', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const raw = Buffer.from('From: test@example.com\r\nSubject: Test\r\n\r\nBody')
      await backend.createFolder('INBOX.ToDelete')
      await backend.append('INBOX.ToDelete', raw, [])
      await backend.deleteFolder('INBOX.ToDelete')
      const folders = await backend.listFolders()
      expect(folders.find(f => f.path === 'INBOX.ToDelete')).toBeUndefined()
    })

    it('throws INVALID if deleting INBOX', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.deleteFolder('INBOX')).rejects.toThrow(MailError)
    })

    it('throws INVALID if deleting special-use folders', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.deleteFolder('INBOX.Envoyés')).rejects.toThrow(MailError)
      await expect(backend.deleteFolder('INBOX.Brouillons')).rejects.toThrow(MailError)
      await expect(backend.deleteFolder('INBOX.Corbeille')).rejects.toThrow(MailError)
      await expect(backend.deleteFolder('INBOX.Spam')).rejects.toThrow(MailError)
      await expect(backend.deleteFolder('INBOX.Archives')).rejects.toThrow(MailError)
    })

    it('throws NOT_FOUND if folder does not exist', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.deleteFolder('INBOX.NonExistent')).rejects.toThrow(MailError)
    })

    it('publishes mailbox change event', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await backend.createFolder('INBOX.ToDelete')
      let changeReceived = false
      const unsub = onMailboxChange('dev@mmi-troyes.fr', () => {
        changeReceived = true
      })
      try {
        await backend.deleteFolder('INBOX.ToDelete')
        expect(changeReceived).toBe(true)
      }
      finally {
        unsub()
      }
    })
  })

  describe('searchHeader', () => {
    it('finds messages by message-id header', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const messageId = '<test-id-123@example.com>'
      const raw = Buffer.from(`From: test@example.com\r\nMessage-ID: ${messageId}\r\nSubject: Test\r\n\r\nBody`)
      const uid = await backend.append('INBOX', raw, [])
      const found = await backend.searchHeader('INBOX', 'message-id', messageId)
      expect(found).toContain(uid)
    })

    it('finds messages by in-reply-to header', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const replyTo = '<original-id@example.com>'
      const raw = Buffer.from(`From: test@example.com\r\nIn-Reply-To: ${replyTo}\r\nSubject: Re: Test\r\n\r\nBody`)
      const uid = await backend.append('INBOX', raw, [])
      const found = await backend.searchHeader('INBOX', 'in-reply-to', replyTo)
      expect(found).toContain(uid)
    })

    it('finds messages by references header (case-insensitive substring match)', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const msgId = 'msg-id-456'
      const raw = Buffer.from(`From: test@example.com\r\nReferences: <other@example.com> <${msgId}@example.com> <another@example.com>\r\nSubject: Test\r\n\r\nBody`)
      const uid = await backend.append('INBOX', raw, [])
      const found = await backend.searchHeader('INBOX', 'references', msgId)
      expect(found).toContain(uid)
    })

    it('returns empty array if no matches', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const found = await backend.searchHeader('INBOX', 'message-id', '<nonexistent@example.com>')
      expect(found).toEqual([])
    })

    it('throws NOT_FOUND for unknown folder', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.searchHeader('UNKNOWN', 'message-id', '<test@example.com>')).rejects.toThrow(MailError)
    })

    it('handles folded headers (multiline)', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const msgId = 'fold-123'
      const raw = Buffer.from(`From: test@example.com\r\nReferences: <first@example.com>\r\n <${msgId}@example.com>\r\n <third@example.com>\r\nSubject: Test\r\n\r\nBody`)
      const uid = await backend.append('INBOX', raw, [])
      const found = await backend.searchHeader('INBOX', 'references', msgId)
      expect(found).toContain(uid)
    })
  })

  describe('summaries', () => {
    it('returns summaries for given uids', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 5 })
      const uids = result.items.map(m => m.uid)
      const summaries = await backend.summaries('INBOX', uids)
      expect(summaries).toHaveLength(uids.length)
      summaries.forEach((s) => {
        expect(s.uid).toBeDefined()
        expect(s.subject).toBeDefined()
        expect(s.from).toBeDefined()
        expect(s.date).toBeDefined()
      })
    })

    it('returns empty array for empty uid list', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const summaries = await backend.summaries('INBOX', [])
      expect(summaries).toEqual([])
    })

    it('ignores missing uids', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid
      const summaries = await backend.summaries('INBOX', [uid, 99999])
      expect(summaries).toHaveLength(1)
      expect(summaries[0].uid).toBe(uid)
    })

    it('throws NOT_FOUND for unknown folder', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      await expect(backend.summaries('UNKNOWN', [1])).rejects.toThrow(MailError)
    })

    it('builds complete message summary', async () => {
      const backend = new MockBackend('dev@mmi-troyes.fr')
      const result = await backend.listMessages('INBOX', { page: 1, pageSize: 1 })
      const uid = result.items[0].uid
      const summaries = await backend.summaries('INBOX', [uid])
      const summary = summaries[0]
      expect(summary.uid).toBe(uid)
      expect(summary.folder).toBe('INBOX')
      expect(summary.subject).toBeDefined()
      expect(summary.from).toBeDefined()
      expect(summary.to).toBeDefined()
      expect(summary.date).toBeDefined()
      expect(typeof summary.seen).toBe('boolean')
      expect(typeof summary.flagged).toBe('boolean')
      expect(typeof summary.hasAttachments).toBe('boolean')
      expect(summary.preview).toBeDefined()
      expect(summary.size).toBeGreaterThan(0)
    })
  })
})

describe('mock live events — orchestrator review', () => {
  it('should publish when a message is delivered, moved, flagged or deleted', async () => {
    const { MockBackend, resetMockStore } = await import('../../../server/lib/mail/mock')
    const { onMailboxChange } = await import('../../../server/lib/live/bus')
    resetMockStore()
    const seen: string[] = []
    const offDev = onMailboxChange('dev@mmi-troyes.fr', c => seen.push(`dev:${c.folder}`))
    const offAlice = onMailboxChange('alice@mmi-troyes.fr', c => seen.push(`alice:${c.folder}`))
    const dev = new MockBackend('dev@mmi-troyes.fr')
    await dev.send(Buffer.from('Subject: x\r\n\r\ny'), { from: 'dev@mmi-troyes.fr', to: ['alice@mmi-troyes.fr'] })
    const { items } = await dev.listMessages('INBOX', { page: 1, pageSize: 1 })
    const uid = items[0]?.uid ?? 0
    await dev.setFlags('INBOX', [uid], { seen: true })
    await dev.move('INBOX', [uid], 'INBOX.Archives')
    offDev()
    offAlice()
    expect(seen).toEqual(['alice:INBOX', 'dev:INBOX', 'dev:INBOX', 'dev:INBOX.Archives'])
  })
})
