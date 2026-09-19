/**
 * Validation du paramètre `returnTo` de GET /api/auth/oidc/start : seul un chemin
 * RELATIF de l'application est accepté (redirection ouverte interdite). Fonction pure.
 */

const MAX_LENGTH = 1024
const PROBE_ORIGIN = 'http://colombe.invalid'

/**
 * Chemin de l'application sûr pour une redirection après connexion, ou null.
 * Refuse : URL absolue (`https://evil`), relative au protocole (`//evil`), barre oblique
 * inverse (`/\evil`, interprétée comme `/` par les navigateurs), caractères de contrôle,
 * routes /api (jamais une page).
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\')) return null
  if (/\s/.test(value) || [...value].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null
  let url: URL
  try {
    url = new URL(value, PROBE_ORIGIN)
  }
  catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN) return null
  const path = `${url.pathname}${url.search}${url.hash}`
  if (path.startsWith('//') || path === '/api' || path.startsWith('/api/')) return null
  return path
}
