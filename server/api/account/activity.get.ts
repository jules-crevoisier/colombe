import type { AccountActivity } from '#shared/types/mail'
import { getAccountActivity } from '../../lib/store/activity'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

export default defineEventHandler(async (event): Promise<AccountActivity> => {
  const { email } = await requireMail(event)
  return getAccountActivity(useDb(), email)
})
