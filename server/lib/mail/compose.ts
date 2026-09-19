import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import type Mail from 'nodemailer/lib/mailer'
import type { ComposePayload } from '#shared/types/mail'
import { sanitizeOutgoingHtml, htmlToText } from './sanitize-outgoing'

export interface BuildOptions {
  /**
   * Conserver l'en-tête Bcc. Uniquement pour les copies stockées (Brouillons,
   * Envoyés) — jamais pour le message transmis en SMTP, sinon les
   * destinataires verraient les copies cachées.
   */
  keepBcc?: boolean
  /** Réutiliser un Message-ID (copie Envoyés identique au message transmis). */
  messageId?: string
  /** Nom affiché de l'identité d'envoi (R2.1) ; sans valeur, `From` reste l'adresse seule. */
  fromName?: string
  /** Adresse « Répondre à » de l'identité (R2.1) ; vide/absent = aucune. */
  replyTo?: string
  /**
   * Convertit chaque image `data:` du HTML en pièce jointe intégrée
   * (`multipart/related`, Content-ID, `src="cid:…"`) : uniquement pour le
   * message réellement transmis (ROADMAP R2.1b). Un brouillon garde ses
   * images en `data:` (jamais activé pour /api/drafts).
   */
  convertInlineImages?: boolean
}

interface InlineImage {
  cid: string
  contentType: string
  content: Buffer
}

const IMG_TAG_RE = /<img\b[^>]*>/gi
const SRC_ATTR_RE = /\ssrc="([^"]*)"/i
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+=*)$/i

/**
 * Remplace chaque `<img src="data:image/…;base64,…">` par `src="cid:…"` et
 * renvoie le contenu binaire à joindre. On analyse nous-mêmes l'URI `data:` —
 * on ne passe jamais d'URL/chemin à nodemailer, qui irait la télécharger (SSRF).
 */
function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = []
  const out = html.replace(IMG_TAG_RE, (tag) => {
    const srcMatch = SRC_ATTR_RE.exec(tag)
    const dataMatch = srcMatch ? DATA_IMAGE_RE.exec(srcMatch[1] ?? '') : null
    if (!dataMatch) return tag

    const format = dataMatch[1]!.toLowerCase()
    const content = Buffer.from(dataMatch[2] ?? '', 'base64')
    const cid = `${randomUUID()}@colombe.inline`
    images.push({ cid, contentType: `image/${format}`, content })
    return tag.replace(SRC_ATTR_RE, ` src="cid:${cid}"`)
  })
  return { html: out, images }
}

export function newMessageId(from: string): string {
  const domain = from.split('@')[1] || 'localhost'
  return `<${randomUUID()}@${domain}>`
}

export async function buildRawMessage(from: string, payload: ComposePayload, opts: BuildOptions = {}): Promise<Buffer> {
  // Prepare HTML content
  let html: string | undefined
  let text = payload.text

  const attachments: Mail.Attachment[] = []

  if (payload.html && payload.html.trim()) {
    // Sanitize HTML before sending
    html = sanitizeOutgoingHtml(payload.html)
    // If text is empty, derive it from HTML
    if (!text.trim()) {
      text = htmlToText(html)
    }
    if (opts.convertInlineImages) {
      const inline = extractInlineImages(html)
      html = inline.html
      attachments.push(...inline.images.map(img => ({
        filename: `image.${img.contentType.split('/')[1]}`,
        content: img.content,
        contentType: img.contentType,
        cid: img.cid,
        contentDisposition: 'inline' as const,
      })))
    }
  }

  // Add regular attachments
  if (payload.attachments) {
    attachments.push(...payload.attachments.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
      contentType: att.contentType,
      // Toujours « attachment » : sinon un message/rfc822 joint est traité comme message intégré.
      contentDisposition: 'attachment' as const,
    })))
  }

  const headers: Record<string, string> = {}

  // Add priority headers
  if (payload.priority === 'high') {
    headers['x-priority'] = '1'
    headers['importance'] = 'high'
  } else if (payload.priority === 'low') {
    headers['x-priority'] = '5'
    headers['importance'] = 'low'
  } else {
    headers['x-priority'] = '3'
    headers['importance'] = 'normal'
  }

  // Add read receipt request
  if (payload.requestReadReceipt) {
    headers['disposition-notification-to'] = from
  }

  const options: Mail.Options = {
    // L'adresse reste toujours celle du login ; seul le nom affiché vient de l'identité (R2.1).
    from: opts.fromName ? { name: opts.fromName, address: from } : from,
    to: payload.to,
    cc: payload.cc.length > 0 ? payload.cc : undefined,
    bcc: payload.bcc.length > 0 ? payload.bcc : undefined,
    subject: payload.subject,
    text: text || undefined,
    html: html || undefined,
    replyTo: opts.replyTo || undefined,
    date: new Date(),
    messageId: opts.messageId ?? newMessageId(from),
    inReplyTo: payload.inReplyTo ?? undefined,
    references: payload.references && payload.references.length > 0 ? payload.references : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    headers,
  }

  const node = new MailComposer(options).compile()
  node.keepBcc = opts.keepBcc === true

  return new Promise<Buffer>((resolve, reject) => {
    node.build((err, message) => (err ? reject(err) : resolve(message)))
  })
}
