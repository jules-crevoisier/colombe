/**
 * URL publiques de Colombe pour la connexion unique : retour du fournisseur
 * (redirect_uri), retour après déconnexion. Fonctions pures (l'origine de la requête est
 * lue par server/utils/oidc-route.ts).
 */

/** Préfixe de déploiement normalisé, toujours terminé par « / » (ex. « /colombe/ »). */
export function normalizeBase(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  return `${trimmed}/`
}

/** `<origine><base>api/auth/oidc/callback`. */
export function deriveRedirectUri(origin: string, baseURL: string): string {
  return `${origin}${normalizeBase(baseURL)}api/auth/oidc/callback`
}

/** URL absolue d'une page de l'application (`path` sans « / » initial, ex. « login »). */
export function appPageUrl(origin: string, baseURL: string, path: string): string {
  return `${origin}${normalizeBase(baseURL)}${path.replace(/^\/+/, '')}`
}
