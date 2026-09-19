/**
 * Aides communes aux routes /api/auth/oidc/* et à la déconnexion (connexion unique).
 */
import type { H3Event } from 'h3'
import type { FlowCookieOptions } from '../lib/auth/oidc/flow'
import { normalizeBase } from '../lib/auth/oidc/urls'

/** Préfixe de déploiement (NUXT_APP_BASE_URL, lu au démarrage), terminé par « / ». */
export function appBase(event: H3Event): string {
  return normalizeBase(useRuntimeConfig(event).app.baseURL)
}

/**
 * Origine publique vue par le navigateur. Derrière un proxy inverse, X-Forwarded-Proto
 * et X-Forwarded-Host ne sont pris en compte que si MAIL_TRUST_PROXY=true.
 */
export function requestOrigin(event: H3Event, trustProxy: boolean): string {
  return getRequestURL(event, { xForwardedHost: trustProxy, xForwardedProto: trustProxy }).origin
}

/** Options du cookie d'état OIDC : même secret et même attribut Secure que la session. */
export function flowCookieOptions(event: H3Event): FlowCookieOptions {
  const session = useRuntimeConfig(event).session as { password?: string; cookie?: { secure?: boolean } }
  return {
    password: session.password ?? '',
    secure: session.cookie?.secure ?? true,
    path: appBase(event),
  }
}

/**
 * Codes d'erreur de /login?error=<code> (messages en français dans app/pages/login.vue).
 * Aucun détail technique ne part vers le navigateur : il est dans les journaux serveur.
 */
export type OidcLoginError =
  | 'expired'
  | 'cancelled'
  | 'idp'
  | 'invalid'
  | 'claim'
  | 'domain'
  | 'mailbox'
  | 'unavailable'
  | 'rate'

/** Panne réseau / délai dépassé vers le fournisseur (pas un échec d'authentification). */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const name = (err as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}
