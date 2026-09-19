import { z } from 'zod'
import { getContactDetail } from '../../lib/store/contacts'
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
    return getContactDetail(db, email, id)
  }
  catch (err) {
    throw contactHttpError(err)
  }
})
