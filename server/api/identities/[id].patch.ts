import { z } from 'zod'
import type { Identity, IdentityInput } from '#shared/types/mail'
import { IdentityNotFoundError, updateIdentity } from '../../lib/store/identities'
import { OutgoingImageError } from '../../lib/mail/sanitize-outgoing'
import { requireMail } from '../../utils/mail-session'
import { useDb } from '../../lib/store/db'

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const bodySchema = z.object({
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
    const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    return updateIdentity(db, email, id, body as Partial<IdentityInput>)
  }
  catch (err) {
    if (err instanceof IdentityNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Identité introuvable', message: err.message })
    if (err instanceof OutgoingImageError) throw createError({ statusCode: 400, statusMessage: 'Image invalide', message: err.message })
    throw err
  }
})
