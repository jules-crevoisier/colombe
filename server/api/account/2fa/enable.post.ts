import { z } from 'zod'
import { verifySecondFactor } from '../../../lib/auth/second-factor'
import { useDb } from '../../../lib/store/db'
import { enableTwoFactor, isTwoFactorEnabled } from '../../../lib/store/twofactor'
import { mailError, requireMail } from '../../../utils/mail-session'

const bodySchema = z.object({ code: z.string().trim().regex(/^\d{3}\s?\d{3}$/, 'Code à 6 chiffres attendu') })

/** Confirme le secret avec un premier code, active la 2FA et renvoie les codes de secours (une seule fois). */
export default defineEventHandler(async (event): Promise<{ recoveryCodes: string[] }> => {
  try {
    const { code } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email } = await requireMail(event)
    const db = useDb()
    if (isTwoFactorEnabled(db, email)) {
      throw createError({ statusCode: 409, statusMessage: 'Déjà active', message: 'La double authentification est déjà active.' })
    }
    if (!verifySecondFactor(db, email, code, { requireEnabled: false, allowRecovery: false })) {
      throw createError({ statusCode: 400, statusMessage: 'Code refusé', message: 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.' })
    }
    return { recoveryCodes: enableTwoFactor(db, email) }
  }
  catch (err) {
    throw mailError(err)
  }
})
