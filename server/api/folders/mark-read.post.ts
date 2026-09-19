import { z } from 'zod'
import { mailError, requireMail } from '../../utils/mail-session'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)

    const uids = await backend.allUids(body.folder)

    // Mark all messages as read in batches of 500
    const batchSize = 500
    for (let i = 0; i < uids.length; i += batchSize) {
      const batch = uids.slice(i, i + batchSize)
      await backend.setFlags(body.folder, batch, { seen: true })
    }

    setResponseStatus(event, 204)
    return null
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
