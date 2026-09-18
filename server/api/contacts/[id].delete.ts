import { z } from 'zod'
import { deleteContact } from '../../lib/store/contacts'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event): Promise<void> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    deleteContact(db, email, id)
    setResponseStatus(event, 204)
  }
  catch (err) {
    if (err instanceof Error && err.message === 'Contact not found') {
      throw createError({ statusCode: 404, statusMessage: 'Contact not found' })
    }
    throw err
  }
})
