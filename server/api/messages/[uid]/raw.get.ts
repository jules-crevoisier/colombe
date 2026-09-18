import { z } from 'zod'
import { buildContentDisposition } from '../../../lib/session/http'
import { mailError, requireMail } from '../../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const querySchema = z.object({
  folder: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const raw = await backend.getRawMessage(query.folder, uid)

    setHeader(event, 'Content-Type', 'application/octet-stream')
    setHeader(event, 'Content-Disposition', buildContentDisposition(`message-${uid}.eml`))
    setHeader(event, 'X-Content-Type-Options', 'nosniff')

    return raw
  } catch (err: unknown) {
    throw mailError(err)
  }
})
