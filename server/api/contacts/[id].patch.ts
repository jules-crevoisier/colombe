import { z } from 'zod'
import { updateContact } from '../../lib/store/contacts'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { Contact } from '#shared/types/mail'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const bodySchema = z.object({
  name: z.string().max(200).optional(),
})

export default defineEventHandler(async (event): Promise<Contact> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    return updateContact(db, email, id, body)
  }
  catch (err) {
    if (err instanceof Error && err.message === 'Contact not found') {
      throw createError({ statusCode: 404, statusMessage: 'Contact not found' })
    }
    throw err
  }
})
