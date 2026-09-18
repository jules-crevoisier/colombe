import { renderSVG } from 'uqr'
import type { TwoFactorSetup } from '#shared/types/mail'
import { dataKey } from '../../../lib/auth/second-factor'
import { generateSecret, otpauthUri } from '../../../lib/auth/totp'
import { useDb } from '../../../lib/store/db'
import { isTwoFactorEnabled, storePendingSecret } from '../../../lib/store/twofactor'
import { mailError, requireMail } from '../../../utils/mail-session'

/** Génère un secret (non actif tant qu'il n'est pas confirmé par un code). QR code rendu localement. */
export default defineEventHandler(async (event): Promise<TwoFactorSetup> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    if (isTwoFactorEnabled(db, email)) {
      throw createError({ statusCode: 409, statusMessage: 'Déjà active', message: 'La double authentification est déjà active.' })
    }
    const secret = generateSecret()
    storePendingSecret(db, email, secret, dataKey())
    const uri = otpauthUri(secret, email)
    return { otpauthUri: uri, qrSvg: renderSVG(uri, { border: 2 }), secret }
  }
  catch (err) {
    throw mailError(err)
  }
})
