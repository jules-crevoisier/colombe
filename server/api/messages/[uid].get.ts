import { z } from 'zod'
import type { MessageDetail } from '#shared/types/mail'
import { parseMessage } from '../../lib/mail/parse'
import { mailError, requireMail } from '../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const querySchema = z.object({ folder: z.string().min(1).max(512) })

export default defineEventHandler(async (event): Promise<MessageDetail> => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const { folder } = await getValidatedQuery(event, q => querySchema.parse(q))
    const { backend } = await requireMail(event)

    const stored = await backend.getMessage(folder, uid)
    if (!stored.seen) await backend.setFlags(folder, [uid], { seen: true })

    return await parseMessage(stored.raw, { uid, folder, seen: true, flagged: stored.flagged, size: stored.size })
  }
  catch (err) {
    throw mailError(err)
  }
})
