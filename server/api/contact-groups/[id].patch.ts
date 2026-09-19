import { z } from 'zod'
import { updateGroup } from '../../lib/store/contact-groups'
import { contactHttpError } from '../../lib/contacts/http-errors'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { ContactGroup } from '#shared/types/mail'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })
const bodySchema = z.object({ name: z.string().trim().min(1).max(100) })

export default defineEventHandler(async (event): Promise<ContactGroup> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const { name } = await readValidatedBody(event, b => bodySchema.parse(b))
    return updateGroup(db, email, id, name)
  }
  catch (err) {
    throw contactHttpError(err, event)
  }
})
