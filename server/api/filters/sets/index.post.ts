import { createFilterSet, sieveError } from '../../../lib/sieve/service'
import { createSetSchema } from '../../../lib/sieve/schemas'
import { requireMail } from '../../../utils/mail-session'

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, (b) => createSetSchema.parse(b))
    const { email, sid } = await requireMail(event)
    const result = await createFilterSet({ event, email, sid }, body.name, body.copyFrom)
    setResponseStatus(event, 201)
    return result
  } catch (err) {
    throw sieveError(err)
  }
})
