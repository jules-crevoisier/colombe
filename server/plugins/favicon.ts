/**
 * Lien favicon dans le HTML initial (pas ajouté par JavaScript, sinon le navigateur
 * demande /favicon.ico à la racine du site avant que la page ne s'hydrate). Injecté
 * au moment de la requête, préfixé par NUXT_APP_BASE_URL lu au RUNTIME : nuxt.config.ts
 * ne peut pas le figer au moment du build, une même archive de release devant pouvoir
 * servir n'importe quel chemin de déploiement (ex. /colombe/).
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const base = useRuntimeConfig(event).app.baseURL || '/'
    html.head.push(`<link rel="icon" type="image/svg+xml" href="${base}favicon.svg">`)
  })
})
