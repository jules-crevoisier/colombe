import { z } from 'zod'
import { listContacts } from '../../lib/store/contacts'
import { searchGroupsWithEmails } from '../../lib/store/contact-groups'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { Contact, ContactSearchResult } from '#shared/types/mail'

const querySchema = z.object({
  q: z.string().optional(),
  // 50 pour l'autocomplétion ; la page Contacts affiche jusqu'à 500 fiches.
  limit: z.coerce.number().int().min(1).max(500).default(20).optional(),
  withGroups: z.coerce.boolean().optional(),
  scope: z.enum(['all', 'collected']).optional(),
  groupId: z.coerce.number().int().positive().optional(),
})

/**
 * Sans `withGroups=1` : réponse historique `Contact[]` (compatibilité).
 * Avec `withGroups=1` : `{ contacts, groups }` pour l'autocomplétion (R2.3).
 */
export default defineEventHandler(async (event): Promise<Contact[] | ContactSearchResult> => {
  const { email } = await requireMail(event)
  const db = useDb()
  const query = await getValidatedQuery(event, q => querySchema.parse(q))
  const contacts = listContacts(db, email, { q: query.q, limit: query.limit ?? 20, scope: query.scope, groupId: query.groupId })

  if (!query.withGroups) return contacts

  const groups = searchGroupsWithEmails(db, email, query.q, query.limit ?? 20)
  return { contacts, groups }
})
