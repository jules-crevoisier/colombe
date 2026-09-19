/** URL d'une route /api construite à la main (lien, téléchargement, EventSource) : préfixée par app.baseURL (déploiement sous /colombe/). */
export function apiUrl(path: string): string {
  const base = useRuntimeConfig().app.baseURL.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}
