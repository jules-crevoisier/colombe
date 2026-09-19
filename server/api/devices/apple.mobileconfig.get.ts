import { authUsername, getConfig } from '../../lib/config'
import { buildAppleProfile, profileFilename } from '../../lib/devices/mobileconfig'
import { mailError, requireMail } from '../../utils/mail-session'

/**
 * Profil de configuration Apple (iPhone, iPad, Mac) pour le compte connecté.
 * Téléchargement uniquement, sans mot de passe : iOS le demande à l'installation.
 */
export default defineEventHandler(async (event) => {
  try {
    const { email } = await requireMail(event)
    const config = getConfig()
    const { imap, smtp } = config.clients
    if (!imap || !smtp) {
      const message = 'Les paramètres de connexion externes ne sont pas configurés par l\'administrateur.'
      throw createError({ statusCode: 409, statusMessage: 'Non configuré', message })
    }
    const body = buildAppleProfile({
      email,
      username: authUsername(email, config),
      imap,
      smtp,
      productName: config.branding.productName,
      orgName: config.branding.orgName,
    })
    setResponseHeaders(event, {
      'Content-Type': 'application/x-apple-aspen-config',
      'Content-Disposition': `attachment; filename="${profileFilename(config.branding.productName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    return body
  }
  catch (err) {
    throw mailError(err)
  }
})
