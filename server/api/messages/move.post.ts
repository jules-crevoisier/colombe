import { z } from 'zod'
import { requireMail, mailError } from '../../utils/mail-session'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.array(z.number().int().positive()).min(1).max(500),
  destination: z.string().min(1).max(512),
}).refine(data => data.folder !== data.destination, {
  message: 'destination doit être différent de folder',
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, body => bodySchema.parse(body))
    const { backend } = await requireMail(event)

    await backend.move(body.folder, body.uids, body.destination)

    setResponseStatus(event, 204)
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
