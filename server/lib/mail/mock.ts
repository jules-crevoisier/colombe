import type { MailBackend, MailCredentials, ListFoldersOptions, ListOptions, ListResult, FlagChange, SendEnvelope, StoredMessage } from './backend'
import { MailError } from './backend'
import { parseMessage } from './parse'
import type { Folder, FolderSize, MessageSummary, QuotaInfo, SpecialUse } from '#shared/types/mail'
import { aliceFixtures, buildFixtureRaw, devFixtures, FOLDERS, MOCK_QUOTA_LIMIT_BYTES } from './mock-fixtures'
import type { FixtureMessage } from './mock-fixtures'
import { publishMailboxChange } from '../live/bus'

interface MockMessage {
  raw: Buffer
  seen: boolean
  flagged: boolean
  flags: string[]
}

interface MockFolder {
  path: string
  name: string
  specialUse: SpecialUse | null
  delimiter: string
  messages: Map<number, MockMessage>
  nextUid: number
  /** Abonnement IMAP (R2.4) : `FOLDERS[].subscribed` (défaut true). */
  subscribed: boolean
}

export const MOCK_USERS = [
  { email: 'dev@mmi-troyes.fr', password: 'dev-password', name: 'Dev Webmail' },
  { email: 'alice@mmi-troyes.fr', password: 'alice-password', name: 'Alice Martin' },
] as const

// Global store shared across MockBackend instances
let mockStore: Map<string, Map<string, MockFolder>> = new Map()
let storeInitialized = false

function seedUser(email: string, fixtures: FixtureMessage[]): void {
  const folders = new Map<string, MockFolder>()
  for (const f of FOLDERS) {
    folders.set(f.path, { path: f.path, name: f.name, specialUse: f.specialUse, delimiter: '.', messages: new Map(), nextUid: 1, subscribed: f.subscribed ?? true })
  }
  // UID croissants dans l'ordre chronologique, comme sur un vrai serveur IMAP.
  const sorted = fixtures.map((m, i) => ({ m, i })).sort((a, b) => a.m.date.getTime() - b.m.date.getTime())
  for (const { m, i } of sorted) {
    const folder = folders.get(m.folder)
    if (!folder) continue
    const flags: string[] = []
    if (m.seen) flags.push('\\Seen')
    if (m.flagged) flags.push('\\Flagged')
    folder.messages.set(folder.nextUid++, { raw: buildFixtureRaw(m, i), seen: m.seen, flagged: m.flagged, flags })
  }
  mockStore.set(email, folders)
}

function initializeStore(): void {
  mockStore = new Map()
  const now = Date.now()
  seedUser('dev@mmi-troyes.fr', devFixtures(now))
  seedUser('alice@mmi-troyes.fr', aliceFixtures(now))
  storeInitialized = true
}

function ensureStore(): void {
  if (!storeInitialized) initializeStore()
}

/** Remet le jeu de données dans son état initial. */
export function resetMockStore(): void {
  initializeStore()
}

export async function verifyMockCredentials(creds: MailCredentials): Promise<boolean> {
  const user = MOCK_USERS.find(u => u.email === creds.email)
  return user ? user.password === creds.password : false
}

export class MockBackend implements MailBackend {
  constructor(private email: string) {
    ensureStore()
  }

  async listFolders(opts: ListFoldersOptions = {}): Promise<Folder[]> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folders: Folder[] = []

    // Order: special folders first, then custom
    const specialOrder = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']
    const all = Array.from(userFolders.values()).filter(f => opts.all || f.subscribed)
    const specialFolders = all.filter(f => f.specialUse)
    const customFolders = all.filter(f => !f.specialUse)

    // Sort special folders by order
    specialFolders.sort((a, b) => {
      const aIdx = specialOrder.indexOf(a.specialUse ?? '')
      const bIdx = specialOrder.indexOf(b.specialUse ?? '')
      return aIdx - bIdx
    })

    // Sort custom folders A-Z
    customFolders.sort((a, b) => a.name.localeCompare(b.name))

    for (const folder of [...specialFolders, ...customFolders]) {
      const unread = Array.from(folder.messages.values()).filter(m => !m.seen).length
      folders.push({
        path: folder.path,
        name: folder.name,
        specialUse: folder.specialUse,
        delimiter: folder.delimiter,
        unread,
        total: folder.messages.size,
        subscribed: folder.subscribed,
      })
    }

    return folders
  }

  async listMessages(folder: string, opts: ListOptions): Promise<ListResult> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    // Collect all messages with parsed metadata
    const allMessages: Array<{ uid: number; msg: MockMessage; parsed: Awaited<ReturnType<typeof parseMessage>> }> = []
    for (const [uid, msg] of folderData.messages.entries()) {
      const parsed = await parseMessage(msg.raw, {
        uid,
        folder,
        seen: msg.seen,
        flagged: msg.flagged,
        size: msg.raw.length,
        flags: msg.flags,
      })
      allMessages.push({ uid, msg, parsed })
    }

    // Apply filters
    let filtered = allMessages
    if (opts.filters) {
      filtered = filtered.filter((m) => {
        if (opts.filters!.unread === true && m.msg.seen) return false
        if (opts.filters!.flagged === true && !m.msg.flagged) return false
        if (opts.filters!.unanswered === true && m.parsed.answered) return false
        if (opts.filters!.attachments === true && !m.parsed.hasAttachments) return false
        if (opts.filters!.since && new Date(m.parsed.date) < new Date(opts.filters!.since)) return false
        if (opts.filters!.before && new Date(m.parsed.date) >= new Date(opts.filters!.before)) return false
        return true
      })
    }

    // Apply text search
    if (opts.query) {
      const query = opts.query.toLowerCase()
      filtered = filtered.filter((m) => {
        const searchFields = opts.fields || ['subject', 'from', 'to', 'cc', 'body']
        let match = false
        if (searchFields.includes('subject')) match = match || m.parsed.subject.toLowerCase().includes(query)
        if (searchFields.includes('from')) match = match || (m.parsed.from?.address.toLowerCase().includes(query) ?? false) || (m.parsed.from?.name.toLowerCase().includes(query) ?? false)
        if (searchFields.includes('to')) match = match || m.parsed.to.some(a => a.address.toLowerCase().includes(query) || a.name.toLowerCase().includes(query))
        if (searchFields.includes('cc')) match = match || m.parsed.cc.some(a => a.address.toLowerCase().includes(query) || a.name.toLowerCase().includes(query))
        if (searchFields.includes('body')) match = match || (m.parsed.text?.toLowerCase().includes(query) ?? false)
        return match
      })
    }

    // Apply sorting
    const sortKey = opts.sort || 'date'
    const order = opts.order || 'desc'
    filtered.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'subject') {
        cmp = a.parsed.subject.localeCompare(b.parsed.subject, 'fr', { sensitivity: 'base' })
      } else if (sortKey === 'from') {
        cmp = (a.parsed.from?.address ?? '').localeCompare(b.parsed.from?.address ?? '')
      } else if (sortKey === 'size') {
        cmp = a.msg.raw.length - b.msg.raw.length
      } else {
        cmp = new Date(a.parsed.date).getTime() - new Date(b.parsed.date).getTime()
      }
      return order === 'desc' ? -cmp : cmp
    })

    // Paginate
    const total = filtered.length
    const page = opts.page || 1
    const pageSize = Math.min(opts.pageSize || 50, 100)
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const pageItems = filtered.slice(start, end)

    const items: MessageSummary[] = pageItems.map(m => ({
      uid: m.uid,
      folder,
      subject: m.parsed.subject,
      from: m.parsed.from,
      to: m.parsed.to,
      date: m.parsed.date,
      seen: m.msg.seen,
      flagged: m.msg.flagged,
      hasAttachments: m.parsed.hasAttachments,
      preview: m.parsed.preview,
      size: m.msg.raw.length,
      answered: m.parsed.answered,
      forwarded: m.parsed.forwarded,
      priority: m.parsed.priority,
    }))

    return { items, total }
  }

  async getRawMessage(folder: string, uid: number): Promise<Buffer> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    const msg = folderData.messages.get(uid)
    if (!msg) {
      throw new MailError('NOT_FOUND', `Message ${uid} not found in ${folder}`)
    }

    return msg.raw
  }

  async getMessage(folder: string, uid: number): Promise<StoredMessage> {
    const raw = await this.getRawMessage(folder, uid)
    const msg = mockStore.get(this.email)?.get(folder)?.messages.get(uid)
    return { raw, seen: msg?.seen ?? false, flagged: msg?.flagged ?? false, size: raw.length, flags: msg?.flags ?? [] }
  }

  async setFlags(folder: string, uids: number[], change: FlagChange): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    for (const uid of uids) {
      const msg = folderData.messages.get(uid)
      if (msg) {
        if (change.seen !== undefined) {
          msg.seen = change.seen
        }
        if (change.flagged !== undefined) {
          msg.flagged = change.flagged
        }
      }
    }
    publishMailboxChange(this.email, folder)
  }

  async move(folder: string, uids: number[], destination: string): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Source folder ${folder} not found`)
    }

    const destData = userFolders.get(destination)
    if (!destData) {
      throw new MailError('NOT_FOUND', `Destination folder ${destination} not found`)
    }

    for (const uid of uids) {
      const msg = folderData.messages.get(uid)
      if (msg) {
        folderData.messages.delete(uid)
        const newUid = destData.nextUid++
        destData.messages.set(newUid, msg)
      }
    }
    publishMailboxChange(this.email, folder)
    publishMailboxChange(this.email, destination)
  }

  async expunge(folder: string, uids: number[]): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    for (const uid of uids) {
      folderData.messages.delete(uid)
    }
    publishMailboxChange(this.email, folder)
  }

  async append(folder: string, raw: Buffer, flags: string[]): Promise<number | null> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    const seen = flags.includes('\\Seen')
    const flagged = flags.includes('\\Flagged')
    const uid = folderData.nextUid++

    folderData.messages.set(uid, { raw, seen, flagged, flags })
    publishMailboxChange(this.email, folder)
    return uid
  }

  async send(raw: Buffer, envelope: SendEnvelope): Promise<void> {
    // For each recipient that is a MOCK_USER, append to their INBOX
    for (const recipient of envelope.to) {
      const recipient_lowercase = recipient.toLowerCase()
      for (const user of MOCK_USERS) {
        if (user.email === recipient_lowercase) {
          const userFolders = mockStore.get(user.email)
          if (userFolders) {
            const inbox = userFolders.get('INBOX')
            if (inbox) {
              const uid = inbox.nextUid++
              inbox.messages.set(uid, { raw, seen: false, flagged: false, flags: [] })
              publishMailboxChange(user.email, 'INBOX')
            }
          }
          break
        }
      }
    }
  }

  async close(): Promise<void> {
    // No-op for mock backend
  }

  async createFolder(path: string): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    if (userFolders.has(path)) {
      throw new MailError('INVALID', `Folder ${path} already exists`)
    }

    // Validate: no empty name, no delimiter at ends
    const parts = path.split('.')
    for (const part of parts) {
      if (!part) {
        throw new MailError('INVALID', 'Folder name cannot be empty or contain only delimiters')
      }
    }

    const folderName = parts[parts.length - 1] ?? path
    userFolders.set(path, {
      path,
      name: folderName,
      specialUse: null,
      delimiter: '.',
      messages: new Map(),
      nextUid: 1,
      subscribed: true,
    })

    publishMailboxChange(this.email, path)
  }

  async renameFolder(path: string, newPath: string): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folder = userFolders.get(path)
    if (!folder) {
      throw new MailError('NOT_FOUND', `Folder ${path} not found`)
    }

    // Cannot rename INBOX or special-use folders
    if (path === 'INBOX' || folder.specialUse) {
      throw new MailError('INVALID', `Cannot rename ${path}`)
    }

    // Cannot rename to existing path
    if (userFolders.has(newPath)) {
      throw new MailError('INVALID', `Folder ${newPath} already exists`)
    }

    // Validate new path
    const newParts = newPath.split('.')
    for (const part of newParts) {
      if (!part) {
        throw new MailError('INVALID', 'Folder name cannot be empty or contain only delimiters')
      }
    }

    // Move the folder
    const newFolderName = newParts[newParts.length - 1] ?? newPath
    const movedFolder = { ...folder, path: newPath, name: newFolderName }
    userFolders.delete(path)
    userFolders.set(newPath, movedFolder)

    // Rename children (prefix-based)
    const childrenToMove: Array<[string, MockFolder]> = []
    for (const [p, f] of userFolders.entries()) {
      if (p.startsWith(path + '.')) {
        const suffix = p.slice(path.length)
        childrenToMove.push([p, f])
      }
    }
    for (const [p, f] of childrenToMove) {
      const suffix = p.slice(path.length)
      const newChildPath = newPath + suffix
      userFolders.delete(p)
      userFolders.set(newChildPath, { ...f, path: newChildPath })
    }

    publishMailboxChange(this.email, newPath)
  }

  async deleteFolder(path: string): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folder = userFolders.get(path)
    if (!folder) {
      throw new MailError('NOT_FOUND', `Folder ${path} not found`)
    }

    // Cannot delete INBOX or special-use folders
    if (path === 'INBOX' || folder.specialUse) {
      throw new MailError('INVALID', `Cannot delete ${path}`)
    }

    // Delete the folder
    userFolders.delete(path)

    // Delete all children
    const toDelete: string[] = []
    for (const p of userFolders.keys()) {
      if (p.startsWith(path + '.')) {
        toDelete.push(p)
      }
    }
    for (const p of toDelete) {
      userFolders.delete(p)
    }

    publishMailboxChange(this.email, path)
  }

  async searchHeader(folder: string, header: 'message-id' | 'references' | 'in-reply-to', value: string): Promise<number[]> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    const found: number[] = []
    for (const [uid, msg] of folderData.messages.entries()) {
      const raw = msg.raw.toString('utf-8')
      const lines = raw.split('\r\n')
      let headerValue = ''
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Empty line marks end of headers
        if (!line) break
        // Header continuation (folded header)
        if (line[0] === ' ' || line[0] === '\t') {
          headerValue += ' ' + line.trim()
          continue
        }
        // New header line
        if (headerValue) {
          const keyMatch = headerValue.split(':', 1)
          const key = keyMatch[0]
          if (key && key.toLowerCase() === header) {
            const val = headerValue.slice(key.length + 1).trim()
            if (val.toLowerCase().includes(value.toLowerCase())) {
              found.push(uid)
              break
            }
          }
        }
        headerValue = line
      }
      // Check last header
      if (headerValue) {
        const keyMatch = headerValue.split(':', 1)
        const key = keyMatch[0]
        if (key && key.toLowerCase() === header) {
          const val = headerValue.slice(key.length + 1).trim()
          if (val.toLowerCase().includes(value.toLowerCase())) {
            found.push(uid)
          }
        }
      }
    }

    return found
  }

  async summaries(folder: string, uids: number[]): Promise<MessageSummary[]> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    const summaries: MessageSummary[] = []
    for (const uid of uids) {
      const msg = folderData.messages.get(uid)
      if (!msg) continue
      const parsed = await parseMessage(msg.raw, {
        uid,
        folder,
        seen: msg.seen,
        flagged: msg.flagged,
        size: msg.raw.length,
        flags: msg.flags,
      })
      summaries.push({
        uid,
        folder,
        subject: parsed.subject,
        from: parsed.from,
        to: parsed.to,
        date: parsed.date,
        seen: msg.seen,
        flagged: msg.flagged,
        hasAttachments: parsed.hasAttachments,
        preview: parsed.preview,
        size: msg.raw.length,
        answered: parsed.answered,
        forwarded: parsed.forwarded,
        priority: parsed.priority,
      })
    }

    return summaries
  }

  async copy(folder: string, uids: number[], destination: string): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Source folder ${folder} not found`)
    }

    const destData = userFolders.get(destination)
    if (!destData) {
      throw new MailError('NOT_FOUND', `Destination folder ${destination} not found`)
    }

    for (const uid of uids) {
      const msg = folderData.messages.get(uid)
      if (msg) {
        const newUid = destData.nextUid++
        destData.messages.set(newUid, { ...msg })
      }
    }
    publishMailboxChange(this.email, destination)
  }

  async setKeywords(folder: string, uids: number[], add: string[], remove: string[]): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    for (const uid of uids) {
      const msg = folderData.messages.get(uid)
      if (msg) {
        const flags = new Set(msg.flags)
        for (const flag of add) {
          flags.add(flag)
        }
        for (const flag of remove) {
          flags.delete(flag)
        }
        msg.flags = Array.from(flags)
      }
    }
    publishMailboxChange(this.email, folder)
  }

  async allUids(folder: string): Promise<number[]> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(folder)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${folder} not found`)
    }

    return Array.from(folderData.messages.keys())
  }

  async subscribeFolder(path: string, subscribed: boolean): Promise<void> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folder = userFolders.get(path)
    if (!folder) {
      throw new MailError('NOT_FOUND', `Folder ${path} not found`)
    }

    folder.subscribed = subscribed
  }

  async getQuota(): Promise<QuotaInfo> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    let usedBytes = 0
    for (const folder of userFolders.values()) {
      for (const msg of folder.messages.values()) {
        usedBytes += msg.raw.length
      }
    }

    return { usedBytes, limitBytes: MOCK_QUOTA_LIMIT_BYTES }
  }

  async folderSize(path: string): Promise<FolderSize> {
    const userFolders = mockStore.get(this.email)
    if (!userFolders) {
      throw new MailError('AUTH_FAILED', 'User not found')
    }

    const folderData = userFolders.get(path)
    if (!folderData) {
      throw new MailError('NOT_FOUND', `Folder ${path} not found`)
    }

    let bytes = 0
    for (const msg of folderData.messages.values()) {
      bytes += msg.raw.length
    }

    return { bytes, messages: folderData.messages.size }
  }
}

ensureStore()
