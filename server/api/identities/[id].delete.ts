import { z } from 'zod'
import { deleteIdentity, IdentityNotFoundError, LastIdentityError } from '../../lib/store/identities'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import { localizedErrorMessage } from '../../lib/i18n'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event): Promise<null> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    deleteIdentity(db, email, id)
    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    if (err instanceof IdentityNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Identité introuvable', message: localizedErrorMessage(event, err) })
    if (err instanceof LastIdentityError) throw createError({ statusCode: 400, statusMessage: 'Dernière identité', message: localizedErrorMessage(event, err) })
    throw err
  }
})
