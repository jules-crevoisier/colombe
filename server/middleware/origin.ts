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

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/') || SAFE_METHODS.has(event.method)) return

  const source = getHeader(event, 'origin') ?? getHeader(event, 'referer')
  const sourceHost = source ? hostOf(source) : null
  const requestHost = getRequestHost(event, { xForwardedHost: true }).toLowerCase()

  if (!sourceHost || sourceHost !== requestHost) {
    throw createError({ statusCode: 403, statusMessage: 'Origine refusée', message: 'Origine refusée' })
  }
})
