/**
 * Protection CSRF complémentaire au cookie SameSite=Lax : toute requête /api
 * mutante doit provenir de la même origine (en-tête Origin, à défaut Referer).
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase()
  }
  catch {
    return null
  }
}

/** Chemin sans le préfixe de déploiement (app.baseURL, ex. « /colombe/ »). */
function pathWithoutBase(path: string, baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base && path.startsWith(`${base}/`) ? path.slice(base.length) : path
}

export default defineEventHandler((event) => {
  const path = pathWithoutBase(event.path, useRuntimeConfig(event).app.baseURL)
  if (!path.startsWith('/api/') || SAFE_METHODS.has(event.method)) return

  const source = getHeader(event, 'origin') ?? getHeader(event, 'referer')
  const sourceHost = source ? hostOf(source) : null
  const requestHost = getRequestHost(event, { xForwardedHost: true }).toLowerCase()

  if (!sourceHost || sourceHost !== requestHost) {
    throw createError({ statusCode: 403, statusMessage: 'Origine refusée', message: 'Origine refusée' })
  }
})
