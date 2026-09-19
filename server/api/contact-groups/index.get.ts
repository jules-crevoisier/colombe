import { listGroups } from '../../lib/store/contact-groups'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import type { ContactGroup } from '#shared/types/mail'

export default defineEventHandler(async (event): Promise<ContactGroup[]> => {
  const { email } = await requireMail(event)
  const db = useDb()
  return listGroups(db, email)
})
