import { getFiltersStatus, sieveError } from '../../lib/sieve/service'
import { requireMail } from '../../utils/mail-session'
import { withServerTiming } from '../../utils/server-timing'

export default defineEventHandler(async (event) => {
  return withServerTiming(event, 'filters', async () => {
    try {
      const { email, sid } = await requireMail(event)
      return await getFiltersStatus({ event, email, sid })
    } catch (err) {
      throw sieveError(err)
    }
  })
})
