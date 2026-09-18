import { z } from 'zod'
import { addContact } from '../../lib/store/contacts'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { Contact, ContactInput } from '#shared/types/mail'

const inputSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200),
})

export default defineEventHandler(async (event): Promise<Contact> => {
  const { email } = await requireMail(event)
  const db = useDb()
  const body = await readValidatedBody(event, b => inputSchema.parse(b))
  const contact = addContact(db, email, body as ContactInput)
  setResponseStatus(event, 201)
  return contact
})
