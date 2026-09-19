import { z } from 'zod'
import { contactDetailInputSchema, updateContactDetail } from '../../lib/store/contacts'
import { contactHttpError } from '../../lib/contacts/http-errors'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { ContactDetail } from '#shared/types/mail'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

export default defineEventHandler(async (event): Promise<ContactDetail> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const body = await readValidatedBody(event, b => contactDetailInputSchema.parse(b))
    return updateContactDetail(db, email, id, body)
  }
  catch (err) {
    throw contactHttpError(err, event)
  }
})
