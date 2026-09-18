import { z } from 'zod'
import { requireMail, mailError } from '../../utils/mail-session'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.array(z.number().int().positive()).min(1).max(500),
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
}).refine(data => data.seen !== undefined || data.flagged !== undefined, {
  message: 'Au moins un de seen ou flagged est requis',
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, body => bodySchema.parse(body))
    const { backend } = await requireMail(event)

    await backend.setFlags(body.folder, body.uids, {
      seen: body.seen,
      flagged: body.flagged,
    })

    setResponseStatus(event, 204)
  } catch (err: unknown) {
    throw mailError(err)
  }
})
