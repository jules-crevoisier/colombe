import { getFiltersStatus, sieveError } from '../../lib/sieve/service'
import { requireMail } from '../../utils/mail-session'

export default defineEventHandler(async (event) => {
  try {
    const { email, sid } = await requireMail(event)
    return await getFiltersStatus({ event, email, sid })
  } catch (err) {
    throw sieveError(err)
  }
})
