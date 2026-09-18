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
}

export function newMessageId(from: string): string {
  const domain = from.split('@')[1] || 'localhost'
  return `<${randomUUID()}@${domain}>`
}

export async function buildRawMessage(from: string, payload: ComposePayload, opts: BuildOptions = {}): Promise<Buffer> {
  // Prepare HTML content
  let html: string | undefined
  let text = payload.text

  if (payload.html && payload.html.trim()) {
    // Sanitize HTML before sending
    html = sanitizeOutgoingHtml(payload.html)
    // If text is empty, derive it from HTML
    if (!text.trim()) {
      text = htmlToText(html)
    }
  }

  const options: Mail.Options = {
    from,
    to: payload.to,
    cc: payload.cc.length > 0 ? payload.cc : undefined,
    bcc: payload.bcc.length > 0 ? payload.bcc : undefined,
    subject: payload.subject,
    text: text || undefined,
    html: html || undefined,
    date: new Date(),
    messageId: opts.messageId ?? newMessageId(from),
    inReplyTo: payload.inReplyTo ?? undefined,
    references: payload.references && payload.references.length > 0 ? payload.references : undefined,
    attachments: payload.attachments?.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
      contentType: att.contentType,
    })),
  }

  const node = new MailComposer(options).compile()
  node.keepBcc = opts.keepBcc === true

  return new Promise<Buffer>((resolve, reject) => {
    node.build((err, message) => (err ? reject(err) : resolve(message)))
  })
}
