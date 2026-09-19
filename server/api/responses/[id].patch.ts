import { z } from 'zod'
import type { CannedResponse, CannedResponseInput } from '#shared/types/mail'
import { ResponseNotFoundError, updateResponse } from '../../lib/store/responses'
import { OutgoingImageError } from '../../lib/mail/sanitize-outgoing'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import { localizedErrorMessage } from '../../lib/i18n'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  html: z.string().max(1_000_000).optional(),
})

export default defineEventHandler(async (event): Promise<CannedResponse> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    return updateResponse(db, email, id, body as Partial<CannedResponseInput>)
  }
  catch (err) {
    if (err instanceof ResponseNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Réponse type introuvable', message: localizedErrorMessage(event, err) })
    if (err instanceof OutgoingImageError) throw createError({ statusCode: 400, statusMessage: 'Image invalide', message: localizedErrorMessage(event, err) })
    throw err
  }
})
