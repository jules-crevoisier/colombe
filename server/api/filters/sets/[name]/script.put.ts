import { z } from 'zod'
import { updateFilterSetScript, sieveError } from '../../../../lib/sieve/service'
import { setScriptBodySchema } from '../../../../lib/sieve/schemas'
import { requireMail } from '../../../../utils/mail-session'

const paramsSchema = z.object({ name: z.string().min(1).max(64) })

export default defineEventHandler(async (event) => {
  try {
    const { name } = await getValidatedRouterParams(event, (p) => paramsSchema.parse(p))
    const body = await readValidatedBody(event, (b) => setScriptBodySchema.parse(b))
    const { email, sid } = await requireMail(event)
    return await updateFilterSetScript({ event, email, sid }, name, body.script, {
      confirmPassword: body.confirmPassword,
      totpCode: body.totpCode,
    })
  } catch (err) {
    throw sieveError(err, event)
  }
})
