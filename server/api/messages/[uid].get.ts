import { z } from 'zod'
import type { MessageDetail } from '#shared/types/mail'
import { parseMessage } from '../../lib/mail/parse'
import { isKnownContact } from '../../lib/store/contacts'
import { useDb } from '../../lib/store/db'
import { mailError, requireMail } from '../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const querySchema = z.object({ folder: z.string().min(1).max(512) })

export default defineEventHandler(async (event): Promise<MessageDetail> => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const { folder } = await getValidatedQuery(event, q => querySchema.parse(q))
    const { email, backend } = await requireMail(event)

    const stored = await backend.getMessage(folder, uid)
    if (!stored.seen) await backend.setFlags(folder, [uid], { seen: true })

    const detail = await parseMessage(stored.raw, { uid, folder, seen: true, flagged: stored.flagged, size: stored.size, flags: stored.flags })
    const senderInContacts = detail.from ? isKnownContact(useDb(), email, detail.from.address) : false
    return { ...detail, senderInContacts }
  }
  catch (err) {
    throw mailError(err)
  }
})
