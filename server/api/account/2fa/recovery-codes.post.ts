import { z } from 'zod'
import { verifySecondFactor } from '../../../lib/auth/second-factor'
import { useDb } from '../../../lib/store/db'
import { isTwoFactorEnabled, replaceRecoveryCodes } from '../../../lib/store/twofactor'
import { mailError, requireMail } from '../../../utils/mail-session'
import { serverT } from '../../../lib/i18n'

const bodySchema = z.object({ code: z.string().trim().regex(/^\d{3}\s?\d{3}$/, 'Code à 6 chiffres attendu') })

/** Régénère les codes de secours (les anciens deviennent invalides). Exige un code TOTP. */
export default defineEventHandler(async (event): Promise<{ recoveryCodes: string[] }> => {
  try {
    const { code } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email } = await requireMail(event)
    const db = useDb()
    if (!isTwoFactorEnabled(db, email)) {
      throw createError({ statusCode: 409, statusMessage: 'Inactive', message: serverT(event, 'twoFactor.notActive') })
    }
    if (!verifySecondFactor(db, email, code, { requireEnabled: true, allowRecovery: false })) {
      throw createError({ statusCode: 400, statusMessage: 'Code refusé', message: serverT(event, 'auth.badCode') })
    }
    return { recoveryCodes: replaceRecoveryCodes(db, email) }
  }
  catch (err) {
    throw mailError(err, event)
  }
})
