import { z } from 'zod'
import type { Identity, IdentityInput } from '#shared/types/mail'
import { addIdentity, IdentityLimitError } from '../../lib/store/identities'
import { OutgoingImageError } from '../../lib/mail/sanitize-outgoing'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'
import { localizedErrorMessage } from '../../lib/i18n'

const inputSchema = z.object({
  name: z.string().trim().max(200).optional(),
  replyTo: z.string().trim().max(320).optional(),
  bcc: z.string().trim().max(320).optional(),
  organization: z.string().trim().max(200).optional(),
  signatureHtml: z.string().max(1_000_000).optional(),
  isDefault: z.boolean().optional(),
})

export default defineEventHandler(async (event): Promise<Identity> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const body = await readValidatedBody(event, b => inputSchema.parse(b))
    const identity = addIdentity(db, email, body as IdentityInput)
    setResponseStatus(event, 201)
    return identity
  }
  catch (err) {
    if (err instanceof IdentityLimitError) throw createError({ statusCode: 400, statusMessage: 'Trop d\'identités', message: localizedErrorMessage(event, err) })
    if (err instanceof OutgoingImageError) throw createError({ statusCode: 400, statusMessage: 'Image invalide', message: localizedErrorMessage(event, err) })
    throw err
  }
})
