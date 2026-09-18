import { z } from 'zod'
import { MailError } from '../../lib/mail/backend'
import { mailError, requireMail } from '../../utils/mail-session'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.array(z.number().int().positive()).min(1).max(200),
  destination: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)

    await backend.copy(body.folder, body.uids, body.destination)
    setResponseStatus(event, 204)
    return null
  } catch (err: unknown) {
    throw mailError(err)
  }
})
