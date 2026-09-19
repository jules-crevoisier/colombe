import type { Identity } from '#shared/types/mail'
import { ensureIdentities } from '../../lib/store/identities'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

export default defineEventHandler(async (event): Promise<Identity[]> => {
  const { email } = await requireMail(event)
  return ensureIdentities(useDb(), email)
})
