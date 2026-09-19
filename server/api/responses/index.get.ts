import type { CannedResponse } from '#shared/types/mail'
import { listResponses } from '../../lib/store/responses'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

export default defineEventHandler(async (event): Promise<CannedResponse[]> => {
  const { email } = await requireMail(event)
  return listResponses(useDb(), email)
})
