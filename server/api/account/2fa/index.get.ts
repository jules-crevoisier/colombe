import type { TwoFactorStatus } from '#shared/types/mail'
import { useDb } from '../../../lib/store/db'
import { twoFactorStatus } from '../../../lib/store/twofactor'
import { mailError, requireMail } from '../../../utils/mail-session'

export default defineEventHandler(async (event): Promise<TwoFactorStatus> => {
  try {
    const { email } = await requireMail(event)
    return twoFactorStatus(useDb(), email)
  }
  catch (err) {
    throw mailError(err, event)
  }
})
