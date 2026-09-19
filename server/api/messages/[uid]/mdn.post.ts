import { z } from 'zod'
import { parseMessage } from '../../../lib/mail/parse'
import { buildMDNMessage } from '../../../lib/mail/mdn'
import { accountLocale } from '../../../lib/i18n/account'
import { mailError, requireMail } from '../../../utils/mail-session'
import { serverT } from '../../../lib/i18n'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const bodySchema = z.object({
  folder: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email, backend } = await requireMail(event)

    const stored = await backend.getMessage(body.folder, uid)
    const msg = await parseMessage(stored.raw, {
      uid,
      folder: body.folder,
      seen: stored.seen,
      flagged: stored.flagged,
      size: stored.size,
      flags: stored.flags,
    })

    if (!msg.readReceiptTo || stored.flags.includes('$MDNSent')) {
      throw createError({ statusCode: 409, statusMessage: 'Accusé non disponible', message: serverT(event, 'messages.mdnUnavailable') })
    }

    const mdnRaw = buildMDNMessage({
      from: email,
      originalMessageId: msg.messageId,
      originalSubject: msg.subject,
      recipientEmail: msg.readReceiptTo.address,
      locale: accountLocale(event, email),
    })

    await backend.send(mdnRaw, { from: email, to: [msg.readReceiptTo.address] })
    await backend.setKeywords(body.folder, [uid], ['$MDNSent'], [])

    setResponseStatus(event, 204)
    return null
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
