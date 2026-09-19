import { z } from 'zod'
import { createGroup } from '../../lib/store/contact-groups'
import { contactHttpError } from '../../lib/contacts/http-errors'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { ContactGroup } from '#shared/types/mail'

const bodySchema = z.object({ name: z.string().trim().min(1).max(100) })

export default defineEventHandler(async (event): Promise<ContactGroup> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { name } = await readValidatedBody(event, b => bodySchema.parse(b))
    const group = createGroup(db, email, name)
    setResponseStatus(event, 201)
    return group
  }
  catch (err) {
    throw contactHttpError(err, event)
  }
})
