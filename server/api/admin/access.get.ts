import type { AdminAccess } from '#shared/types/server-status'
import { getConfig } from '../../lib/config'
import { mailError, requireMail } from '../../utils/mail-session'

/**
 * Droits d'administration du compte connecté : l'interface s'en sert pour
 * afficher ou masquer l'onglet « État du serveur ». Le contrôle réel reste
 * fait par chaque route d'administration.
 */
export default defineEventHandler(async (event): Promise<AdminAccess> => {
  try {
    const { email } = await requireMail(event)
    const { adminEmails, file } = getConfig().serverStatus
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return { serverStatus: Boolean(file) && adminEmails.includes(email.toLowerCase()) }
  }
  catch (err) {
    throw mailError(err, event)
  }
})
