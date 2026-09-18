import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { sendLimiter } from '../../../lib/session/rate-limit'
import { mailError, requireMail } from '../../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  to: z.array(z.string().trim().email()).min(1).max(50),
})

export default defineEventHandler(async (event) => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email, backend } = await requireMail(event)

    const key = `email:${email}`
    if (sendLimiter.isLimited(key)) {
      throw createError({ statusCode: 429, statusMessage: 'Limite d\'envoi atteinte', message: 'Limite d\'envoi atteinte. Réessayez plus tard.' })
    }

    const raw = await backend.getRawMessage(body.folder, uid)

    const lines = raw.toString('utf-8', 0, raw.length).split('\r\n')
    const headerEndIdx = lines.findIndex(l => !l)
    if (headerEndIdx === -1) {
      throw createError({ statusCode: 400, statusMessage: 'Format invalide', message: 'Message mal formé' })
    }

    const now = new Date()
    const newMessageId = `<${randomUUID()}@${email.split('@')[1]}>`
    const resentHeaders = [
      `Resent-From: ${email}`,
      `Resent-To: ${body.to.join(', ')}`,
      `Resent-Date: ${now.toUTCString()}`,
      `Resent-Message-ID: ${newMessageId}`,
    ]

    const modifiedRaw = Buffer.from(
      [...lines.slice(0, headerEndIdx), ...resentHeaders, '', ...lines.slice(headerEndIdx + 1)].join('\r\n'),
      'utf-8'
    )

    sendLimiter.hit(key)
    await backend.send(modifiedRaw, { from: email, to: body.to })

    setResponseStatus(event, 204)
    return null
  } catch (err: unknown) {
    throw mailError(err)
  }
})
