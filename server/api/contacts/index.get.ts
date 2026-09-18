import { z } from 'zod'
import { listContacts } from '../../lib/store/contacts'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { Contact } from '#shared/types/mail'

const querySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
})

export default defineEventHandler(async (event): Promise<Contact[]> => {
  const { email } = await requireMail(event)
  const db = useDb()
  const query = await getValidatedQuery(event, q => querySchema.parse(q))
  return listContacts(db, email, { q: query.q, limit: query.limit ?? 20 })
})
