import { z } from 'zod'
import { exportFilterSet, sieveError } from '../../../../lib/sieve/service'
import { buildContentDisposition } from '../../../../lib/session/http'
import { requireMail } from '../../../../utils/mail-session'

const paramsSchema = z.object({ name: z.string().min(1).max(64) })

export default defineEventHandler(async (event) => {
  try {
    const { name } = await getValidatedRouterParams(event, (p) => paramsSchema.parse(p))
    const { email, sid } = await requireMail(event)
    const { filename, content } = await exportFilterSet({ event, email, sid }, name)

    setHeader(event, 'Content-Type', 'application/octet-stream')
    setHeader(event, 'Content-Disposition', buildContentDisposition(filename))
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return content
  } catch (err) {
    throw sieveError(err)
  }
})
