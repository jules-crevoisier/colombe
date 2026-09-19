import type { H3Event } from 'h3'
import { authUsername, getConfig } from '../lib/config'
import { AUTODISCOVER_MAX_BODY, buildAutodiscover, extractAutodiscoverEmail } from '../lib/devices/autodiscover'

/**
 * Autodiscover Outlook, public : /autodiscover/autodiscover.xml.
 *
 * Outlook demande aussi bien « /autodiscover/autodiscover.xml » que
 * « /Autodiscover/Autodiscover.xml ». Deux dossiers ne différant que par la casse
 * ne peuvent pas coexister sous Windows (ni dans une archive extraite sur un
 * disque insensible à la casse) : la route est donc reconnue ici, sans tenir compte
 * de la casse, plutôt que par deux fichiers dans server/routes/.
 *
 * Hors de /api/ : le middleware d'origine (CSRF) ne s'applique pas, ce qui est
 * voulu pour un POST venant d'Outlook. Rien n'est écrit, aucune session n'est lue.
 */
const PATH = '/autodiscover/autodiscover.xml'

/** Chemin sans le préfixe de déploiement (app.baseURL, ex. « /colombe/ ») ni la requête. */
function routePath(event: H3Event): string {
  const path = event.path.split('?')[0] ?? ''
  const base = useRuntimeConfig(event).app.baseURL.replace(/\/+$/, '')
  return base && path.startsWith(`${base}/`) ? path.slice(base.length) : path
}

/** Corps de la requête, au plus AUTODISCOVER_MAX_BODY octets ; au-delà, ignoré. */
async function readLimitedBody(event: H3Event): Promise<string> {
  const declared = Number(getRequestHeader(event, 'content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > AUTODISCOVER_MAX_BODY) return ''
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buf.length
    // Corps trop long (sans Content-Length fiable) : on arrête de lire et on l'ignore.
    if (size > AUTODISCOVER_MAX_BODY) return ''
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export default defineEventHandler(async (event) => {
  if (routePath(event).toLowerCase() !== PATH) return
  if (event.method !== 'GET' && event.method !== 'HEAD' && event.method !== 'POST') {
    setResponseHeader(event, 'Allow', 'GET, HEAD, POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const config = getConfig()
  const { imap, smtp } = config.clients
  if (!imap || !smtp) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Configuration automatique non disponible.' })

  const body = event.method === 'POST' ? await readLimitedBody(event) : ''
  const email = extractAutodiscoverEmail(body, config.login.domains)

  setResponseHeaders(event, {
    'Content-Type': 'application/xml; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  return buildAutodiscover({ imap, smtp, loginName: email ? authUsername(email, config) : null })
})
