import { getConfig } from '../../lib/config'
import { buildAutoconfig } from '../../lib/devices/autoconfig'

/**
 * Détection automatique Thunderbird (« autoconfig »), publique et sans données
 * d'utilisateur. Également servie sur /.well-known/autoconfig/mail/config-v1.1.xml.
 * 404 tant que l'administrateur n'a pas publié les serveurs (MAIL_PUBLIC_*).
 */
export default defineEventHandler((event) => {
  const config = getConfig()
  const { imap, smtp, username } = config.clients
  const xml = imap && smtp
    ? buildAutoconfig({ domains: config.login.domains, imap, smtp, username, productName: config.branding.productName, orgName: config.branding.orgName })
    : null
  if (!xml) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Configuration automatique non disponible.' })
  setResponseHeaders(event, {
    'Content-Type': 'application/xml; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=3600',
  })
  return xml
})
