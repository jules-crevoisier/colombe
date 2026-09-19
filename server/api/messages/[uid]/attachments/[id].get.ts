import { z } from 'zod'
import { getAttachment } from '../../../../lib/mail/parse'
import { buildContentDisposition } from '../../../../lib/session/http'
import { requireMail, mailError } from '../../../../utils/mail-session'

const paramsSchema = z.object({
  uid: z.coerce.number().int().positive(),
  id: z.string().min(1).max(255),
})

const querySchema = z.object({
  folder: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const params = await getValidatedRouterParams(event, body => paramsSchema.parse(body))
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const raw = await backend.getRawMessage(query.folder, params.uid)
    const attachment = await getAttachment(raw, params.id)

    if (!attachment) {
      setResponseStatus(event, 404)
      throw createError({ statusCode: 404, statusMessage: 'Pièce jointe non trouvée' })
    }

    setHeader(event, 'Content-Type', 'application/octet-stream')
    setHeader(event, 'Content-Disposition', buildContentDisposition(attachment.filename))
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox")
    setHeader(event, 'Cache-Control', 'private, no-store')

    return attachment.content
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
