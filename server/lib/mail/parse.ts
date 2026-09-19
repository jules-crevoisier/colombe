import { simpleParser } from 'mailparser'
import type { AddressObject, Attachment, EmailAddress, ParsedMail } from 'mailparser'
import { sanitizeEmailHtml } from './sanitize'
import type { Address, AttachmentMeta, MessageDetail, Priority } from '#shared/types/mail'

export interface MessageContext {
  uid: number
  folder: string
  seen: boolean
  flagged: boolean
  size: number
  flags?: string[]
}

const INLINE_IMAGE_TYPE = /^image\/(?:png|jpe?g|gif|webp)$/i
const INLINE_IMAGE_MAX = 2 * 1024 * 1024

function flattenAddresses(list: EmailAddress[]): Address[] {
  return list.flatMap((a) => {
    if (a.group) return flattenAddresses(a.group)
    return a.address ? [{ name: a.name || '', address: a.address }] : []
  })
}

function toAddresses(field: AddressObject | AddressObject[] | undefined): Address[] {
  if (!field) return []
  const objects = Array.isArray(field) ? field : [field]
  return objects.flatMap(o => flattenAddresses(o.value))
}

function cidOf(att: Attachment): string | null {
  return att.contentId ? att.contentId.replace(/^<|>$/g, '') : null
}

/**
 * Sépare les images intégrées réellement référencées par le HTML (cid:) des
 * pièces jointes. Certains clients (Apple Mail…) posent un Content-ID sur
 * toutes les pièces jointes : on ne masque que celles utilisées dans le corps.
 * `parseMessage` et `getAttachment` partagent cette logique pour que les
 * identifiants de pièces jointes restent cohérents.
 */
function classifyAttachments(parsed: ParsedMail): { inline: Record<string, string>; files: Attachment[] } {
  const html = typeof parsed.html === 'string' ? parsed.html : ''
  const inline: Record<string, string> = {}
  const files: Attachment[] = []

  for (const att of parsed.attachments) {
    const cid = cidOf(att)
    const referenced = cid !== null && html.includes(`cid:${cid}`)
    if (referenced && INLINE_IMAGE_TYPE.test(att.contentType) && att.size <= INLINE_IMAGE_MAX) {
      inline[cid] = `data:${att.contentType.toLowerCase()};base64,${att.content.toString('base64')}`
      continue
    }
    if (referenced && att.contentDisposition === 'inline') continue
    files.push(att)
  }
  return { inline, files }
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
}

function buildPreview(text: string | null, html: string | null): string {
  const source = text
    ?? decodeBasicEntities((html ?? '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
  return source.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Priorité : mailparser interprète déjà X-Priority / X-MSMail-Priority / Importance
 * dans `parsed.priority` (les en-têtes bruts ne sont pas conservés sous ce nom).
 */
function extractPriority(parsed: ParsedMail): Priority {
  if (parsed.priority === 'high' || parsed.priority === 'low') return parsed.priority
  // Repli sur les lignes brutes : « X-Priority: 1 » seul n'est pas toujours interprété.
  const line = (key: string) => {
    const lower = key.toLowerCase()
    const header = parsed.headerLines.find(h => h.key.toLowerCase() === lower)
    if (!header) return ''
    // Extract everything after the first colon
    const colonIndex = header.line.indexOf(':')
    return colonIndex >= 0 ? header.line.slice(colonIndex + 1).trim().toLowerCase() : ''
  }
  const x = Number.parseInt(line('x-priority'), 10)
  if (x === 1 || x === 2) return 'high'
  if (x === 4 || x === 5) return 'low'
  const importance = line('importance') || line('x-msmail-priority')
  if (importance === 'high') return 'high'
  if (importance === 'low') return 'low'
  return 'normal'
}

/**
 * Adresse de l'en-tête List-Post (RFC 2369), sans « mailto: » ni chevrons.
 * `List-Post: NO` (liste sans réponse possible) ou en-tête absent → null.
 */
function extractListPost(parsed: ParsedMail): string | null {
  // mailparser regroupe les en-têtes List-* sous `headers.get('list')` (objet
  // sans l'URL d'origine) : on repart de la ligne brute.
  const line = parsed.headerLines.find(h => h.key === 'list-post')?.line
  if (!line) return null
  const raw = line.slice(line.indexOf(':') + 1).replace(/\r?\n[ \t]+/g, ' ').trim()
  const bracketed = raw.match(/<mailto:([^>]+)>/i)
  if (bracketed?.[1]) return bracketed[1].trim()
  const bare = raw.match(/^mailto:(.+)$/i)
  if (bare?.[1]) return bare[1].trim()
  return null
}

function isAddressObject(value: unknown): value is AddressObject {
  return typeof value === 'object' && value !== null && Array.isArray((value as { value?: unknown }).value)
}

/**
 * Destinataire de l'accusé de lecture demandé (Disposition-Notification-To),
 * sauf s'il a déjà été envoyé ($MDNSent). mailparser fournit un objet adresse.
 */
function extractReadReceiptTo(parsed: ParsedMail, flags: string[] | undefined): Address | null {
  if (flags?.includes('$MDNSent')) return null
  const header = parsed.headers.get('disposition-notification-to')
  if (!header) return null

  // Handle AddressObject
  if (isAddressObject(header)) {
    const addresses = toAddresses(header)
    if (addresses.length > 0) return addresses[0] ?? null
  }

  // Handle string
  if (typeof header === 'string') {
    const address = (header.match(/<([^>]+)>/)?.[1] ?? header).trim()
    return /^[^\s@]+@[^\s@]+$/.test(address) ? { name: '', address } : null
  }

  // Handle object with toString method
  try {
    const str = String(header ?? '').trim()
    if (str && str !== '[object Object]') {
      const address = (str.match(/<([^>]+)>/)?.[1] ?? str).trim()
      return /^[^\s@]+@[^\s@]+$/.test(address) ? { name: '', address } : null
    }
  }
  catch {
    // ignore
  }

  return null
}

export async function parseMessage(raw: Buffer, ctx: MessageContext): Promise<MessageDetail> {
  const parsed = await simpleParser(raw, { keepCidLinks: true })
  const { inline, files } = classifyAttachments(parsed)

  const text = parsed.text || null
  let html: string | null = null
  let remoteImages = 0
  if (typeof parsed.html === 'string' && parsed.html.trim()) {
    const sanitized = sanitizeEmailHtml(parsed.html, inline)
    html = sanitized.html
    remoteImages = sanitized.remoteImages
  }

  const attachments: AttachmentMeta[] = files.map((att, index) => ({
    id: String(index),
    filename: att.filename || 'piece-jointe',
    contentType: att.contentType || 'application/octet-stream',
    size: att.size || att.content.length,
  }))

  const subject = parsed.subject?.trim() ? parsed.subject : '(sans objet)'
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references ? [parsed.references] : []

  const flags = ctx.flags ?? []
  const answered = flags.includes('\\Answered')
  const forwarded = flags.includes('$Forwarded')
  const priority = extractPriority(parsed)
  const readReceiptTo = extractReadReceiptTo(parsed, flags)
  const listPost = extractListPost(parsed)

  return {
    uid: ctx.uid,
    folder: ctx.folder,
    subject,
    from: toAddresses(parsed.from)[0] ?? null,
    to: toAddresses(parsed.to),
    cc: toAddresses(parsed.cc),
    // Un Bcc n'est présent que dans nos propres brouillons / envoyés.
    bcc: toAddresses(parsed.bcc),
    replyTo: toAddresses(parsed.replyTo),
    date: (parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date(0)).toISOString(),
    seen: ctx.seen,
    flagged: ctx.flagged,
    hasAttachments: attachments.length > 0,
    preview: buildPreview(text, html),
    size: ctx.size,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    html,
    text,
    remoteImages,
    attachments,
    answered,
    forwarded,
    priority,
    readReceiptTo,
    listPost,
    // Nécessite un accès à la base de contacts (propriétaire) : calculé par
    // l'appelant (server/api/messages/[uid].get.ts), jamais ici (parse.ts
    // reste pur, sans dépendance à SQLite).
    senderInContacts: false,
  }
}

export async function getAttachment(raw: Buffer, id: string): Promise<{ filename: string; content: Buffer } | null> {
  const parsed = await simpleParser(raw, { keepCidLinks: true })
  const att = classifyAttachments(parsed).files[Number(id)]
  if (!/^\d+$/.test(id) || !att) return null
  return { filename: att.filename || 'piece-jointe', content: att.content }
}
