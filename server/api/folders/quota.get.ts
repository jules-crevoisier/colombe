import type { QuotaInfo } from '#shared/types/mail'
import { mailError, requireMail } from '../../utils/mail-session'

/** Quota du compte (R2.4). `limitBytes: null` si le serveur ne le fournit pas. */
export default defineEventHandler(async (event): Promise<QuotaInfo> => {
  try {
    const { backend } = await requireMail(event)
    return await backend.getQuota()
  }
  catch (err) {
    throw mailError(err)
  }
})
