import { z } from 'zod'
import { removeGroupMembers } from '../../../lib/store/contact-groups'
import { contactHttpError } from '../../../lib/contacts/http-errors'
import { requireMail } from '../../../utils/mail-session'
import { useDb } from '../../../lib/store/db'

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })
const bodySchema = z.object({ contactIds: z.array(z.number().int().positive()).min(1).max(500) })

export default defineEventHandler(async (event): Promise<void> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const { contactIds } = await readValidatedBody(event, b => bodySchema.parse(b))
    removeGroupMembers(db, email, id, contactIds)
    setResponseStatus(event, 204)
  }
  catch (err) {
    throw contactHttpError(err)
  }
})
