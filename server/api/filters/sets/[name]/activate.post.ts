import { z } from 'zod'
import { activateFilterSet, sieveError } from '../../../../lib/sieve/service'
import { requireMail } from '../../../../utils/mail-session'

const paramsSchema = z.object({ name: z.string().min(1).max(64) })

export default defineEventHandler(async (event) => {
  try {
    const { name } = await getValidatedRouterParams(event, (p) => paramsSchema.parse(p))
    const { email, sid } = await requireMail(event)
    await activateFilterSet({ event, email, sid }, name)
    setResponseStatus(event, 204)
    return null
  } catch (err) {
    throw sieveError(err, event)
  }
})
