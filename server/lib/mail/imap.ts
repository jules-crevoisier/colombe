import { ImapFlow } from 'imapflow'
import type { FetchMessageObject, ListResponse, MessageAddressObject, MessageStructureObject, SearchObject } from 'imapflow'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport'
import type { Address, Folder, FolderSize, MessageSummary, QuotaInfo, SearchField, SortKey, SpecialUse } from '#shared/types/mail'
import { MailError } from './backend'
import { imapAuth, smtpAuth } from './sasl'
import type {
  FlagChange,
  ListFoldersOptions,
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

const SEARCH_FIELD_KEY: Record<SearchField, 'subject' | 'from' | 'to' | 'cc' | 'body'> = {
  subject: 'subject',
  from: 'from',
  to: 'to',
  cc: 'cc',
  body: 'body',
}

/**
 * Combine au plus deux champs de recherche en un seul OR IMAP **non imbriqué**
 * (`OR clé1 clé2`). Au-delà de deux champs, IMAP n'a pas d'autre choix que d'imbriquer
 * (`OR a (OR b c)`) pour rester à deux opérandes par OR — or GreenMail échoue
 * silencieusement (aucune erreur, aucun résultat) sur ce genre d'imbrication. Pour 3+
 * champs, voir `searchByFieldsUnion` : une commande SEARCH par champ, union en mémoire.
 */
function fieldSearchCriteria(fields: SearchField[], q: string): SearchObject {
  const [first, second] = fields.map((f): SearchObject => ({ [SEARCH_FIELD_KEY[f]]: q }))
  if (!first) return { all: true }
  if (!second) return first
  return { or: [first, second] }
}

/** Construit les critères IMAP SEARCH pour `query`/`fields` (≤ 2 champs), sans les filtres (voir `applyFilters`). */
function textSearchCriteria(query: string | undefined, fields: SearchField[] | undefined): SearchObject {
  const q = query?.trim()
  if (!q) return { all: true }
  if (fields && fields.length > 0) return fieldSearchCriteria(fields, q)
  // Pas de champs précisés : TEXT couvre en-têtes (sujet, expéditeur, destinataires) et corps.
  return { text: q }
}

/** Ajoute les filtres R1.2 (non-lu, suivi, sans réponse, pièce jointe, dates) aux critères. */
function applyFilters(criteria: SearchObject, filters: ListOptions['filters']): SearchObject {
  if (!filters) return criteria
  const result: SearchObject = { ...criteria }
  if (filters.unread === true) result.seen = false
  if (filters.flagged === true) result.flagged = true
  if (filters.unanswered === true) result.answered = false
  if (filters.since) result.since = filters.since
  if (filters.before) result.before = filters.before
  // Approximation IMAP : pas d'inspection de bodyStructure ici (coûteux pour tous les
  // messages) — on regarde si l'en-tête Content-Type contient multipart/mixed.
  if (filters.attachments === true) result.header = { ...result.header, 'content-type': 'multipart/mixed' }
  return result
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

/** Construit un `MessageSummary` à partir d'un message récupéré (envelope + bodyStructure). */
function toSummary(uid: number, folder: string, m: FetchMessageObject, preview: string): MessageSummary {
  const env = m.envelope
  const flags = m.flags ? Array.from(m.flags) : []
  const answered = flags.includes('\\Answered')
  const forwarded = flags.includes('$Forwarded')
  const priority = extractPriority(m.headers)
  return {
    uid,
    folder,
    subject: env?.subject?.trim() || '(sans objet)',
    from: toAddresses(env?.from)[0] ?? null,
    to: toAddresses(env?.to),
    date: toIso(env?.date ?? m.internalDate),
    seen: m.flags?.has('\\Seen') ?? false,
    flagged: m.flags?.has('\\Flagged') ?? false,
    hasAttachments: hasAttachments(m.bodyStructure),
    preview,
    size: m.size ?? 0,
    answered,
    forwarded,
    priority,
  }
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
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    servername: config.imapServername,
    tls: { rejectUnauthorized: config.tlsRejectUnauthorized !== false },
    auth: imapAuth(creds, config),
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
  /** Identité d'authentification du transport courant (jeton OIDC ou type de session). */
  private transportAuthKey: string | null = null
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

  async listFolders(opts: ListFoldersOptions = {}): Promise<Folder[]> {
    const client = await this.imap()
    try {
      const query = { statusQuery: { messages: true, unseen: true } }
      let entries = await client.list(query)
      if (await this.ensureSpecialFolders(client, entries)) entries = await client.list(query)

      return entries
        .filter(e => !e.flags.has('\\Noselect') && !e.flags.has('\\NonExistent'))
        .filter(e => opts.all || e.subscribed !== false)
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
      const uids = await this.searchUids(client, opts)
      const sort = opts.sort ?? 'date'
      const order = opts.order ?? 'desc'
      const orderedUids = await this.sortUids(client, uids, sort, order)

      const start = (opts.page - 1) * opts.pageSize
      const pageUids = orderedUids.slice(start, start + opts.pageSize)
      if (pageUids.length === 0) return { items: [], total: orderedUids.length }

      // La prévisualisation (et bodyStructure/envelope complets) n'est jamais récupérée
      // pour plus qu'une page de résultats — c'était le coût principal des listes lentes.
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
        return [toSummary(uid, folder, m, previews.get(uid) ?? '')]
      })
      return { items, total: orderedUids.length }
    })
  }

  /** Recherche les UIDs correspondant à `opts`, avec repli sur TEXT si le serveur rejette la recherche. */
  private async searchUids(client: ImapFlow, opts: ListOptions): Promise<number[]> {
    const q = opts.query?.trim()
    if (q && opts.fields && opts.fields.length > 2) {
      // 3+ champs : jamais de OR imbriqué en une seule commande (GreenMail échoue
      // silencieusement dessus) — une recherche par champ, puis union des UID.
      return this.searchByFieldsUnion(client, opts.fields, q, opts.filters)
    }
    const primary = applyFilters(textSearchCriteria(opts.query, opts.fields), opts.filters)
    try {
      const found = await client.search(primary, { uid: true })
      return Array.isArray(found) ? found : []
    }
    catch (err) {
      // Une combinaison de champs (OR) ou de filtres a pu être rejetée par le serveur :
      // on retente en cherchant sur tout (sujet + expéditeur + destinataires + corps)
      // plutôt que d'échouer la liste entière.
      if (!opts.fields?.length && !opts.filters) throw err
      const fallback = applyFilters(textSearchCriteria(opts.query, undefined), opts.filters)
      const found = await client.search(fallback, { uid: true })
      return Array.isArray(found) ? found : []
    }
  }

  /**
   * Recherche `q` séparément dans chaque champ de `fields` (une commande SEARCH par champ,
   * jamais un seul OR à 3+ opérandes) et renvoie l'union des UID trouvés. Un champ dont la
   * recherche échoue ne fait pas échouer les autres. Si rien n'est trouvé (tous les champs
   * vides ou en erreur), retente une recherche TEXT globale plutôt que de renvoyer une liste
   * vide à tort.
   */
  private async searchByFieldsUnion(client: ImapFlow, fields: SearchField[], q: string, filters: ListOptions['filters']): Promise<number[]> {
    const uids = new Set<number>()
    for (const field of fields) {
      try {
        const criteria = applyFilters(fieldSearchCriteria([field], q), filters)
        const found = await client.search(criteria, { uid: true })
        if (Array.isArray(found)) for (const uid of found) uids.add(uid)
      }
      catch {
        // Ce champ n'a pas pu être cherché sur ce serveur : on continue avec les autres.
      }
    }
    if (uids.size > 0) return [...uids]

    const fallback = applyFilters(textSearchCriteria(q, undefined), filters)
    const found = await client.search(fallback, { uid: true })
    return Array.isArray(found) ? found : []
  }

  /**
   * Ordonne les UIDs trouvés. Pour `date` (par défaut), l'ordre UID suffit (croissant =
   * ordre d'arrivée) et ne coûte rien. Pour `from`/`subject`/`size`, on récupère l'attribut
   * léger correspondant (envelope ou taille — jamais bodyStructure ni preview) pour TOUS
   * les UIDs trouvés, on trie en mémoire, puis seule la page demandée sera enrichie ensuite.
   */
  private async sortUids(client: ImapFlow, uids: number[], sort: SortKey, order: 'asc' | 'desc'): Promise<number[]> {
    if (sort === 'date') {
      // UID croissant = ordre d'arrivée : les plus récents en premier par défaut.
      return [...uids].sort((a, b) => (order === 'desc' ? b - a : a - b))
    }
    if (uids.length === 0) return []

    const attrByUid = new Map<number, string | number>()
    if (sort === 'size') {
      const fetched = await client.fetchAll(uidRange(uids), { uid: true, size: true }, { uid: true })
      for (const m of fetched) attrByUid.set(m.uid, m.size ?? 0)
    }
    else {
      const fetched = await client.fetchAll(uidRange(uids), { uid: true, envelope: true }, { uid: true })
      for (const m of fetched) {
        const value = sort === 'subject'
          ? (m.envelope?.subject?.trim() || '')
          : (toAddresses(m.envelope?.from)[0]?.address ?? '')
        attrByUid.set(m.uid, value)
      }
    }

    const compare = (a: number, b: number): number => {
      const av = attrByUid.get(a)
      const bv = attrByUid.get(b)
      const cmp = sort === 'size'
        ? (Number(av ?? 0) - Number(bv ?? 0))
        : String(av ?? '').localeCompare(String(bv ?? ''), 'fr', { sensitivity: 'base' })
      return order === 'desc' ? -cmp : cmp
    }
    return [...uids].sort(compare)
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
    // Session OIDC : le jeton d'accès change à chaque rafraîchissement (objet `auth` muté
    // en place, voir credentials.ts) ; le transport est reconstruit quand il a changé.
    const authKey = this.creds.auth.kind === 'oauth2' ? this.creds.auth.accessToken : this.creds.auth.kind
    if (this.transport && this.transportAuthKey !== authKey) {
      this.transport.close()
      this.transport = null
    }
    if (!this.transport) {
      const { auth, customAuth } = smtpAuth(this.creds, this.config)
      this.transport = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        requireTLS: this.config.smtpRequireTls,
        tls: { servername: this.config.smtpServername, rejectUnauthorized: this.config.tlsRejectUnauthorized !== false },
        auth,
        ...(customAuth ? { customAuth } : {}),
        connectionTimeout: 15_000,
      } satisfies SMTPTransportOptions)
      this.transportAuthKey = authKey
    }
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
        return [toSummary(uid, folder, m, previews.get(uid) ?? '')]
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

  async subscribeFolder(path: string, subscribed: boolean): Promise<void> {
    const client = await this.imap()
    try {
      const ok = subscribed ? await client.mailboxSubscribe(path) : await client.mailboxUnsubscribe(path)
      if (!ok) throw new MailError('NOT_FOUND', `Dossier ${path} introuvable`)
    }
    catch (err) {
      if (err instanceof MailError) throw err
      throw toMailError(err, `Abonnement au dossier ${path}`)
    }
  }

  async getQuota(): Promise<QuotaInfo> {
    const client = await this.imap()
    try {
      const result = await client.getQuota('INBOX')
      if (!result || !result.storage) return { usedBytes: 0, limitBytes: null }
      // imapflow@2.0.5 : le runtime remplit `.usage` alors que le type déclare `.used` ; on lit les deux.
      const storage = result.storage as unknown as { used?: number; usage?: number; limit?: number }
      return { usedBytes: storage.used ?? storage.usage ?? 0, limitBytes: storage.limit ?? null }
    }
    catch (err) {
      throw toMailError(err, 'Quota')
    }
  }

  async folderSize(path: string): Promise<FolderSize> {
    return this.withMailbox(path, true, async (client) => {
      const status = await client.status(path, { messages: true, size: true }).catch(() => false as const)
      if (status && typeof status.size === 'number') {
        return { bytes: status.size, messages: status.messages ?? 0 }
      }

      // Serveur sans STATUS=SIZE (GreenMail, la plupart des Dovecot par défaut) :
      // on additionne la taille de chaque message.
      const found = await client.search({ all: true }, { uid: true })
      const uids = Array.isArray(found) ? found : []
      if (!uids.length) return { bytes: 0, messages: 0 }

      const fetched = await client.fetchAll(uidRange(uids), { uid: true, size: true }, { uid: true })
      const bytes = fetched.reduce((sum, m) => sum + (m.size ?? 0), 0)
      return { bytes, messages: uids.length }
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
