import { randomUUID } from 'node:crypto'
import type { AppLocale } from '#shared/types/i18n'
import { translate } from '../i18n'

interface MDNOptions {
  from: string
  originalMessageId: string | null
  originalSubject: string
  recipientEmail: string
  /** Langue de la partie lisible (préférence du compte qui envoie l'accusé), défaut français. */
  locale?: AppLocale
}

export function buildMDNMessage(opts: MDNOptions): Buffer {
  const now = new Date()
  const messageId = `<${randomUUID()}@${opts.from.split('@')[1] || 'localhost'}>`

  // Partie lisible, dans la langue du compte qui envoie l'accusé.
  const locale = opts.locale ?? 'fr'
  const intl = locale === 'fr' ? 'fr-FR' : 'en-GB'
  const humanReadable = translate(locale, 'mdn.body', { date: now.toLocaleDateString(intl), time: now.toLocaleTimeString(intl), subject: opts.originalSubject })

  // Machine-readable part (RFC 3798)
  const machineReadable = `Reporting-UA: Colombe; webmail
MDN-Gateway: rfc822; ${opts.from}
Final-Recipient: rfc822;${opts.from}
Original-Message-ID: ${opts.originalMessageId || '<unknown>'}
Disposition: manual-action/MDN-sent-manually; displayed`

  const boundary = `----=_mdn_${randomUUID()}`

  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.recipientEmail}`,
    `Subject: Read: ${opts.originalSubject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"`,
    `Content-Language: ${locale}`,
    '',
  ]

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    humanReadable,
    '',
    `--${boundary}`,
    'Content-Type: message/disposition-notification; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    machineReadable,
    '',
    `--${boundary}--`,
  ]

  return Buffer.from(`${headers.join('\r\n')}\r\n${body.join('\r\n')}`, 'utf-8')
}
