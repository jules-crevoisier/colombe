import { z } from 'zod'
import type { CannedResponse, CannedResponseInput } from '#shared/types/mail'
import { addResponse, ResponseLimitError } from '../../lib/store/responses'
import { OutgoingImageError } from '../../lib/mail/sanitize-outgoing'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import { localizedErrorMessage } from '../../lib/i18n'

const inputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  html: z.string().max(1_000_000),
})

export default defineEventHandler(async (event): Promise<CannedResponse> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const body = await readValidatedBody(event, b => inputSchema.parse(b))
    const response = addResponse(db, email, body as CannedResponseInput)
    setResponseStatus(event, 201)
    return response
  }
  catch (err) {
    if (err instanceof ResponseLimitError) throw createError({ statusCode: 400, statusMessage: 'Trop de réponses types', message: localizedErrorMessage(event, err) })
    if (err instanceof OutgoingImageError) throw createError({ statusCode: 400, statusMessage: 'Image invalide', message: localizedErrorMessage(event, err) })
    throw err
  }
})
