import { putForward, sieveError } from '../../lib/sieve/service'
import { forwardSchema } from '../../lib/sieve/schemas'
import { requireMail } from '../../utils/mail-session'

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, (b) => forwardSchema.parse(b))
    const { email, sid } = await requireMail(event)
    // Ne jamais faire transiter confirmPassword/totpCode au-delà de la validation
    // (ni vers le script Sieve stocké, ni dans la réponse JSON).
    const { confirmPassword, totpCode, ...settings } = body
    return await putForward({ event, email, sid }, settings, { confirmPassword, totpCode })
  } catch (err) {
    throw sieveError(err)
  }
})
