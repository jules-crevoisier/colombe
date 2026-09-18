import { simpleParser } from 'mailparser'
import type { AddressObject, Attachment, EmailAddress, ParsedMail } from 'mailparser'
import { sanitizeEmailHtml } from './sanitize'
import type { Address, AttachmentMeta, MessageDetail } from '#shared/types/mail'

export interface MessageContext {
  uid: number
  folder: string
  seen: boolean
  flagged: boolean
  size: number
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
  }
}

export async function getAttachment(raw: Buffer, id: string): Promise<{ filename: string; content: Buffer } | null> {
  const parsed = await simpleParser(raw, { keepCidLinks: true })
  const att = classifyAttachments(parsed).files[Number(id)]
  if (!/^\d+$/.test(id) || !att) return null
  return { filename: att.filename || 'piece-jointe', content: att.content }
}
