import { z } from 'zod'
import { verifySecondFactor } from '../../../lib/auth/second-factor'
import { useDb } from '../../../lib/store/db'
import { disableTwoFactor, isTwoFactorEnabled } from '../../../lib/store/twofactor'
import { mailError, requireMail } from '../../../utils/mail-session'

const bodySchema = z.object({ code: z.string().trim().min(6).max(32) })

/** Désactivation : exige un code valide (une session volée ne suffit pas à retirer la protection). */
export default defineEventHandler(async (event) => {
  try {
    const { code } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email } = await requireMail(event)
    const db = useDb()
    if (!isTwoFactorEnabled(db, email)) {
      throw createError({ statusCode: 409, statusMessage: 'Inactive', message: 'La double authentification n’est pas active.' })
    }
    if (!verifySecondFactor(db, email, code, { requireEnabled: true, allowRecovery: true })) {
      throw createError({ statusCode: 400, statusMessage: 'Code refusé', message: 'Code incorrect.' })
    }
    disableTwoFactor(db, email)
    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    throw mailError(err)
  }
})
