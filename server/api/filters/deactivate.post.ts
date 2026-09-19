import { deactivateFilters, sieveError } from '../../lib/sieve/service'
import { requireMail } from '../../utils/mail-session'

export default defineEventHandler(async (event) => {
  try {
    const { email, sid } = await requireMail(event)
    await deactivateFilters({ event, email, sid })
    setResponseStatus(event, 204)
    return null
  } catch (err) {
    throw sieveError(err, event)
  }
})
