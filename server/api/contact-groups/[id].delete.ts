import { z } from 'zod'
import { deleteGroup } from '../../lib/store/contact-groups'
import { contactHttpError } from '../../lib/contacts/http-errors'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

export default defineEventHandler(async (event): Promise<void> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    deleteGroup(db, email, id)
    setResponseStatus(event, 204)
  }
  catch (err) {
    throw contactHttpError(err)
  }
})
