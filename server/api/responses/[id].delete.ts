import { z } from 'zod'
import { deleteResponse, ResponseNotFoundError } from '../../lib/store/responses'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event): Promise<null> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    deleteResponse(db, email, id)
    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    if (err instanceof ResponseNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Réponse type introuvable', message: err.message })
    throw err
  }
})
