import { ImapFlow } from 'imapflow'
import type { FetchMessageObject, ListResponse, MessageAddressObject, MessageStructureObject } from 'imapflow'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { Address, Folder, MessageSummary, SpecialUse } from '#shared/types/mail'
import { MailError } from './backend'
import type {
  FlagChange,
  ListOptions,
  ListResult,
  MailBackend,
  MailCredentials,
  MailServerConfig,
  SendEnvelope,
  StoredMessage,
} from './backend'

const SPECIAL_USE: Record<string, SpecialUse> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
}

const DISPLAY_NAME: Record<SpecialUse, string> = {
  inbox: 'Boîte de réception',
  sent: 'Envoyés',
  drafts: 'Brouillons',
  trash: 'Corbeille',
  junk: 'Spam',
  archive: 'Archives',
}

/** Noms créés quand le serveur n'a pas le dossier spécial (détectés par nom par imapflow). */
const DEFAULT_PATH: Record<Exclude<SpecialUse, 'inbox'>, string> = {
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
  junk: 'Junk',
  archive: 'Archive',
}

const PREVIEW_BYTES = 2048

interface ImapErrorShape {
  authenticationFailed?: boolean
  serverResponseCode?: string
  responseText?: string
  code?: string
  message?: string
}

function asImapError(err: unknown): ImapErrorShape {
  return typeof err === 'object' && err !== null ? (err as ImapErrorShape) : {}
}

function isMissingMailbox(err: unknown): boolean {
  const e = asImapError(err)
  return e.serverResponseCode === 'NONEXISTENT'
    || /nonexist|does ?n[o']t exist|not exist|no such|unknown mailbox|not found/i.test(e.responseText ?? '')
}

function toMailError(err: unknown, context: string): MailError {
  if (err instanceof MailError) return err
  if (asImapError(err).authenticationFailed) return new MailError('AUTH_FAILED', 'Authentification refusée')
  if (isMissingMailbox(err)) return new MailError('NOT_FOUND', `${context} : introuvable`)
  return new MailError('UNAVAILABLE', `${context} : serveur de messagerie indisponible`)
}

function uidRange(uids: number[]): string {
  return uids.join(',')
}

function toAddresses(list: MessageAddressObject[] | undefined): Address[] {
  return (list ?? []).flatMap(a => (a.address ? [{ name: a.name ?? '', address: a.address }] : []))
}

function toIso(value: Date | string | undefined): string {
  const date = value ? new Date(value) : new Date(0)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function leaves(node: MessageStructureObject, insideRelated = false): Array<{ node: MessageStructureObject; insideRelated: boolean }> {
  if (node.childNodes?.length) {
    const related = insideRelated || node.type === 'multipart/related'
    return node.childNodes.flatMap(child => leaves(child, related))
  }
  return [{ node, insideRelated }]
}

function hasAttachments(structure: MessageStructureObject | undefined): boolean {
  if (!structure) return false
  return leaves(structure).some(({ node, insideRelated }) => {
    if (node.disposition === 'attachment') return true
    const named = Boolean(node.dispositionParameters?.filename ?? node.parameters?.name)
    return named && node.disposition !== 'inline' && !insideRelated && !node.type.startsWith('text/')
  })
}

function extractPriority(headers?: unknown): 'high' | 'normal' | 'low' {
  if (!headers) return 'normal'

  const headerMap = headers as Map<string, string | string[]> | undefined
  if (!headerMap) return 'normal'

  const xPriority = headerMap.get?.('x-priority')
  const importance = headerMap.get?.('importance')

  if (xPriority) {
    const num = Number.parseInt(String(xPriority), 10)
    if (num <= 2) return 'high'
    if (num >= 4) return 'low'
  }

  if (importance) {
    const imp = String(importance).toLowerCase()
    if (imp === 'high') return 'high'
    if (imp === 'low') return 'low'
  }

  return 'normal'
}

/** Première partie texte affichable, pour l'extrait de la liste. */
function previewPart(structure: MessageStructureObject | undefined): MessageStructureObject | null {
  if (!structure) return null
  const candidates = leaves(structure).map(l => l.node).filter(n => n.disposition !== 'attachment')
  return candidates.find(n => n.type === 'text/plain') ?? candidates.find(n => n.type === 'text/html') ?? null
}

function decodeQuotedPrintable(buf: Buffer): Buffer {
  const s = buf.toString('latin1').replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const hex = s.slice(i + 1, i + 3)
    if (s[i] === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      i += 2
    }
    else {
      bytes.push(s.charCodeAt(i) & 0xFF)
    }
  }
  return Buffer.from(bytes)
}

function decodeCharset(buf: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf)
  }
  catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

export function decodePreview(part: MessageStructureObject, body: Buffer): string {
  let bytes = body
  const encoding = (part.encoding ?? '').toLowerCase()
  if (encoding === 'base64') {
    const b64 = body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '')
    bytes = Buffer.from(b64.slice(0, b64.length - (b64.length % 4)), 'base64')
  }
  else if (encoding === 'quoted-printable') {
    bytes = decodeQuotedPrintable(body)
  }
  let text = decodeCharset(bytes, part.parameters?.charset).replace(/�+$/, '')
  if (part.type === 'text/html') {
    text = text
      .replace(/<(style|script|head)[\s\S]*?(<\/\1>|$)/gi, ' ')
      .replace(/<[^>]*>?/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function newClient(creds: MailCredentials, config: MailServerConfig): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.imapPort,
    secure: config.imapSecure,
    servername: config.host,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 5 * 60_000,
  })
  // Sans écouteur, une erreur réseau ferait tomber le processus Nitro.
  client.on('error', () => {})
  return client
}

export class ImapBackend implements MailBackend {
  private client: ImapFlow | null = null
  private connecting: Promise<ImapFlow> | null = null
  private transport: Transporter | null = null
  private specialFoldersChecked = false

  constructor(private readonly creds: MailCredentials, private readonly config: MailServerConfig) {}

  private async imap(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client
    if (this.connecting) return this.connecting

    const client = newClient(this.creds, this.config)
    this.connecting = client.connect()
      .then(() => {
        client.on('close', () => {
          if (this.client === client) this.client = null
        })
        this.client = client
        return client
      })
      .catch((err: unknown) => {
        throw toMailError(err, 'Connexion')
      })
      .finally(() => {
        this.connecting = null
      })
    return this.connecting
  }

  private async withMailbox<T>(path: string, readOnly: boolean, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = await this.imap()
    let lock
    try {
      lock = await client.getMailboxLock(path, { readOnly })
    }
    catch (err) {
      throw toMailError(err, `Dossier ${path}`)
    }
    try {
      return await fn(client)
    }
    catch (err) {
      throw toMailError(err, `Dossier ${path}`)
    }
    finally {
      lock.release()
    }
  }

  private static specialUseOf(entry: ListResponse): SpecialUse | null {
    if (entry.path.toUpperCase() === 'INBOX') return 'inbox'
    return entry.specialUse ? SPECIAL_USE[entry.specialUse] ?? null : null
  }

  private async ensureSpecialFolders(client: ImapFlow, entries: ListResponse[]): Promise<boolean> {
    if (this.specialFoldersChecked) return false
    this.specialFoldersChecked = true
    const present = new Set(entries.map(e => ImapBackend.specialUseOf(e)))
    const prefix = client.namespace?.prefix ?? ''
    let created = false
    for (const [use, name] of Object.entries(DEFAULT_PATH) as Array<[Exclude<SpecialUse, 'inbox'>, string]>) {
      if (present.has(use)) continue
      const path = `${prefix}${name}`
      if (entries.some(e => e.path === path)) continue
      try {
        await client.mailboxCreate(path)
        await client.mailboxSubscribe(path)
        created = true
      }
      catch {
        // Droits insuffisants ou dossier concurrent : le dossier restera absent.
      }
    }
    return created
  }

  async listFolders(): Promise<Folder[]> {
    const client = await this.imap()
    try {
      const query = { statusQuery: { messages: true, unseen: true } }
      let entries = await client.list(query)
      if (await this.ensureSpecialFolders(client, entries)) entries = await client.list(query)

      return entries
        .filter(e => !e.flags.has('\\Noselect') && !e.flags.has('\\NonExistent'))
        .map((e) => {
          const specialUse = ImapBackend.specialUseOf(e)
          return {
            path: e.path,
            name: specialUse ? DISPLAY_NAME[specialUse] : e.name,
            specialUse,
            delimiter: e.delimiter,
            unread: e.status?.unseen ?? 0,
            total: e.status?.messages ?? 0,
            subscribed: e.subscribed ?? true,
          }
        })
    }
    catch (err) {
      throw toMailError(err, 'Liste des dossiers')
    }
  }

  async listMessages(folder: string, opts: ListOptions): Promise<ListResult> {
    return this.withMailbox(folder, true, async (client) => {
      const q = opts.query?.trim()
      // TEXT couvre en-têtes (sujet, expéditeur, destinataires) et corps.
      const criteria = q ? { text: q } : { all: true }
      const found = await client.search(criteria, { uid: true })
      // UID croissant = ordre d'arrivée : les plus récents en premier.
      const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a)
      const start = (opts.page - 1) * opts.pageSize
      const pageUids = uids.slice(start, start + opts.pageSize)
      if (pageUids.length === 0) return { items: [], total: uids.length }

      const messages = await client.fetchAll(
        uidRange(pageUids),
        { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true, headers: ['x-priority', 'importance'] },
        { uid: true },
      )
      const previews = await this.fetchPreviews(client, messages)
      const byUid = new Map(messages.map(m => [m.uid, m]))

      const items = pageUids.flatMap((uid): MessageSummary[] => {
        const m = byUid.get(uid)
        if (!m) return []
        const env = m.envelope
        const flags = m.flags ? Array.from(m.flags) : []
        const answered = flags.includes('\\Answered')
        const forwarded = flags.includes('$Forwarded')
        const priority = extractPriority(m.headers)
        return [{
          uid,
          folder,
          subject: env?.subject?.trim() || '(sans objet)',
          from: toAddresses(env?.from)[0] ?? null,
          to: toAddresses(env?.to),
          date: toIso(env?.date ?? m.internalDate),
          seen: m.flags?.has('\\Seen') ?? false,
          flagged: m.flags?.has('\\Flagged') ?? false,
          hasAttachments: hasAttachments(m.bodyStructure),
          preview: previews.get(uid) ?? '',
          size: m.size ?? 0,
          answered,
          forwarded,
          priority,
        }]
      })
      return { items, total: uids.length }
    })
  }

  /** Récupère au plus 2 Ko de la première partie texte, groupé par identifiant de partie. */
  private async fetchPreviews(client: ImapFlow, messages: FetchMessageObject[]): Promise<Map<number, string>> {
    const groups = new Map<string, Array<{ uid: number; part: MessageStructureObject }>>()
    for (const m of messages) {
      const part = previewPart(m.bodyStructure)
      if (!part) continue
      const key = part.part ?? '1'
      groups.set(key, [...(groups.get(key) ?? []), { uid: m.uid, part }])
    }

    const previews = new Map<number, string>()
    for (const [key, entries] of groups) {
      const fetched = await client.fetchAll(
        uidRange(entries.map(e => e.uid)),
        { uid: true, bodyParts: [{ key, maxLength: PREVIEW_BYTES }] },
        { uid: true },
      )
      const partsByUid = new Map(entries.map(e => [e.uid, e.part]))
      for (const f of fetched) {
        const part = partsByUid.get(f.uid)
        const body = f.bodyParts?.get(key)
        if (part && body) previews.set(f.uid, decodePreview(part, body))
      }
    }
    return previews
  }

  async getMessage(folder: string, uid: number): Promise<StoredMessage> {
    return this.withMailbox(folder, true, async (client) => {
      const msg = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, size: true }, { uid: true })
      if (!msg || !msg.source) throw new MailError('NOT_FOUND', `Message ${uid} introuvable`)
      const flags = msg.flags ? Array.from(msg.flags) : []
      return {
        raw: msg.source,
        seen: msg.flags?.has('\\Seen') ?? false,
        flagged: msg.flags?.has('\\Flagged') ?? false,
        size: msg.size ?? msg.source.length,
        flags,
      }
    })
  }

  async getRawMessage(folder: string, uid: number): Promise<Buffer> {
    return (await this.getMessage(folder, uid)).raw
  }

  async setFlags(folder: string, uids: number[], change: FlagChange): Promise<void> {
    await this.withMailbox(folder, false, async (client) => {
      const range = uidRange(uids)
      for (const [flag, value] of [['\\Seen', change.seen], ['\\Flagged', change.flagged]] as const) {
        if (value === true) await client.messageFlagsAdd(range, [flag], { uid: true })
        if (value === false) await client.messageFlagsRemove(range, [flag], { uid: true })
      }
    })
  }

  async move(folder: string, uids: number[], destination: string): Promise<void> {
    await this.withMailbox(folder, false, async (client) => {
      const result = await client.messageMove(uidRange(uids), destination, { uid: true })
      if (result === false) throw new MailError('NOT_FOUND', `Dossier ${destination} introuvable`)
    })
  }

  async expunge(folder: string, uids: number[]): Promise<void> {
    await this.withMailbox(folder, false, async (client) => {
      await client.messageDelete(uidRange(uids), { uid: true })
    })
  }

  async append(folder: string, raw: Buffer, flags: string[]): Promise<number | null> {
    const client = await this.imap()
    try {
      const result = await client.append(folder, raw, flags)
      if (result === false) throw new MailError('NOT_FOUND', `Dossier ${folder} introuvable`)
      return result.uid ?? null
    }
    catch (err) {
      throw toMailError(err, `Dossier ${folder}`)
    }
  }

  async send(raw: Buffer, envelope: SendEnvelope): Promise<void> {
    this.transport ??= nodemailer.createTransport({
      host: this.config.host,
      port: this.config.smtpPort,
      secure: this.config.smtpPort === 465,
      requireTLS: this.config.smtpRequireTls,
      tls: { servername: this.config.host },
      auth: { user: this.creds.email, pass: this.creds.password },
      connectionTimeout: 15_000,
    })
    try {
      const mailOpts: any = { envelope: { from: envelope.from, to: envelope.to }, raw }
      if (envelope.dsn) {
        mailOpts.envelope.dsn = { notify: ['success', 'failure'] }
      }
      await this.transport.sendMail(mailOpts)
    }
    catch (err) {
      const e = asImapError(err)
      if (e.code === 'EAUTH') throw new MailError('AUTH_FAILED', 'Authentification SMTP refusée')
      throw new MailError('UNAVAILABLE', 'Envoi impossible : serveur SMTP indisponible')
    }
  }

  async createFolder(path: string): Promise<void> {
    const client = await this.imap()
    try {
      await client.mailboxCreate(path)
      await client.mailboxSubscribe(path)
    }
    catch (err) {
      throw toMailError(err, `Création du dossier ${path}`)
    }
  }

  async renameFolder(path: string, newPath: string): Promise<void> {
    const client = await this.imap()
    try {
      // Fetch folders to check special uses
      const folders = await this.listFolders()
      const folder = folders.find(f => f.path === path)
      if (!folder) {
        throw new MailError('NOT_FOUND', `Folder ${path} not found`)
      }
      if (path === 'INBOX' || folder.specialUse) {
        throw new MailError('INVALID', `Cannot rename ${path}`)
      }
      const destExists = folders.find(f => f.path === newPath)
      if (destExists) {
        throw new MailError('INVALID', `Folder ${newPath} already exists`)
      }
      await client.mailboxRename(path, newPath)
    }
    catch (err) {
      if (err instanceof MailError) throw err
      throw toMailError(err, `Renommage du dossier ${path}`)
    }
  }

  async deleteFolder(path: string): Promise<void> {
    const client = await this.imap()
    try {
      // Fetch folders to check special uses
      const folders = await this.listFolders()
      const folder = folders.find(f => f.path === path)
      if (!folder) {
        throw new MailError('NOT_FOUND', `Folder ${path} not found`)
      }
      if (path === 'INBOX' || folder.specialUse) {
        throw new MailError('INVALID', `Cannot delete ${path}`)
      }
      await client.mailboxDelete(path)
    }
    catch (err) {
      if (err instanceof MailError) throw err
      throw toMailError(err, `Suppression du dossier ${path}`)
    }
  }

  async searchHeader(folder: string, header: 'message-id' | 'references' | 'in-reply-to', value: string): Promise<number[]> {
    // Recherche côté serveur uniquement : jamais de téléchargement du dossier entier.
    return this.withMailbox(folder, true, async (client) => {
      const found = await client.search({ header: { [header]: value } }, { uid: true })
      return Array.isArray(found) ? found : []
    })
  }
  async summaries(folder: string, uids: number[]): Promise<MessageSummary[]> {
    if (uids.length === 0) return []
    return this.withMailbox(folder, true, async (client) => {
      const messages = await client.fetchAll(
        uidRange(uids),
        { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true, headers: ['x-priority', 'importance'] },
        { uid: true },
      )
      const previews = await this.fetchPreviews(client, messages)
      const byUid = new Map(messages.map(m => [m.uid, m]))

      const items = uids.flatMap((uid): MessageSummary[] => {
        const m = byUid.get(uid)
        if (!m) return []
        const env = m.envelope
        const flags = m.flags ? Array.from(m.flags) : []
        const answered = flags.includes('\\Answered')
        const forwarded = flags.includes('$Forwarded')
        const priority = extractPriority(m.headers)
        return [{
          uid,
          folder,
          subject: env?.subject?.trim() || '(sans objet)',
          from: toAddresses(env?.from)[0] ?? null,
          to: toAddresses(env?.to),
          date: toIso(env?.date ?? m.internalDate),
          seen: m.flags?.has('\\Seen') ?? false,
          flagged: m.flags?.has('\\Flagged') ?? false,
          hasAttachments: hasAttachments(m.bodyStructure),
          preview: previews.get(uid) ?? '',
          size: m.size ?? 0,
          answered,
          forwarded,
          priority,
        }]
      })
      return items
    })
  }

  async copy(folder: string, uids: number[], destination: string): Promise<void> {
    await this.withMailbox(folder, false, async (client) => {
      const result = await client.messageCopy(uidRange(uids), destination, { uid: true })
      if (result === false) throw new MailError('NOT_FOUND', `Dossier ${destination} introuvable`)
    })
  }

  async setKeywords(folder: string, uids: number[], add: string[], remove: string[]): Promise<void> {
    await this.withMailbox(folder, false, async (client) => {
      const range = uidRange(uids)
      for (const flag of add) {
        await client.messageFlagsAdd(range, [flag], { uid: true })
      }
      for (const flag of remove) {
        await client.messageFlagsRemove(range, [flag], { uid: true })
      }
    })
  }

  async allUids(folder: string): Promise<number[]> {
    return this.withMailbox(folder, true, async (client) => {
      const found = await client.search({ all: true }, { uid: true })
      return Array.isArray(found) ? found : []
    })
  }

  async close(): Promise<void> {
    this.transport?.close()
    this.transport = null
    const client = this.client
    this.client = null
    if (client?.usable) {
      try {
        await client.logout()
      }
      catch {
        client.close()
      }
    }
  }
}

/** true = identifiants valides ; false = refusés ; MailError('UNAVAILABLE') = serveur injoignable. */
export async function verifyImapCredentials(creds: MailCredentials, config: MailServerConfig): Promise<boolean> {
  const client = newClient(creds, config)
  try {
    await client.connect()
    await client.logout()
    return true
  }
  catch (err) {
    client.close()
    if (asImapError(err).authenticationFailed) return false
    throw new MailError('UNAVAILABLE', 'Serveur de messagerie indisponible')
  }
}
