import type { ServerStatusResponse } from '#shared/types/server-status'
import { getConfig } from '../../lib/config'
import { serverT } from '../../lib/i18n'
import { readServerStatus } from '../../lib/server-status'
import { mailError, requireMail } from '../../utils/mail-session'

/**
 * État du serveur mail (etat.json écrit par le script de surveillance),
 * réservé aux adresses listées dans COLOMBE_ADMIN_EMAILS.
 *
 * Ordre des refus : 401 sans session, 404 si la page n'est pas configurée,
 * 403 pour un compte qui n'est pas administrateur. Le contenu n'est jamais mis
 * en cache et ne révèle ni le chemin du fichier ni le détail d'une erreur.
 */
export default defineEventHandler(async (event): Promise<ServerStatusResponse> => {
  try {
    const { email } = await requireMail(event)
    const { adminEmails, file } = getConfig().serverStatus
    if (!adminEmails.length || !file) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: serverT(event, 'admin.notConfigured') })
    }
    if (!adminEmails.includes(email.toLowerCase())) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: serverT(event, 'admin.forbidden') })
    }
    setResponseHeader(event, 'Cache-Control', 'no-store')
    const status = await readServerStatus(file)
    return status ? { available: true, status } : { available: false }
  }
  catch (err) {
    throw mailError(err, event)
  }
})
