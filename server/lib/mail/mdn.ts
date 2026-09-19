import { randomUUID } from 'node:crypto'

interface MDNOptions {
  from: string
  originalMessageId: string | null
  originalSubject: string
  recipientEmail: string
}

export function buildMDNMessage(opts: MDNOptions): Buffer {
  const now = new Date()
  const messageId = `<${randomUUID()}@${opts.from.split('@')[1] || 'localhost'}>`

  // Human-readable part in French
  const humanReadable = `Cet accusé de lecture confirme que le message reçu le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR')} a bien été consulté.\n\nObjet du message: ${opts.originalSubject}\n\nCet accusé de lecture a été généré automatiquement par Colombe.`

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
    'Content-Language: fr',
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
