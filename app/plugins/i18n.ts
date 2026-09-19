import { applyLocale, browserLanguages, currentLocale, i18n, readStoredLanguage, resolveLocale } from '~/lib/i18n'

/**
 * Langue de l'interface (vue-i18n, API de composition).
 *
 * Langue initiale, avant tout appel réseau : choix mémorisé dans ce navigateur
 * (`colombe.lang`, écrit par le sélecteur de la page de connexion ou recopié depuis
 * la préférence du compte), sinon langue du navigateur, sinon français. La langue par
 * défaut de l'établissement et la préférence du compte sont appliquées ensuite par
 * useLanguage() (app.vue), dès qu'elles sont connues.
 *
 * Chaque requête vers l'application porte `Accept-Language` = langue active : les
 * messages d'erreur renvoyés par l'API (affichés tels quels) arrivent dans la bonne
 * langue. Le point d'interception est `fetch` lui-même : l'instance `$fetch` de Nuxt
 * (ofetch) est capturée par les modules avant les plugins, mais appelle toujours
 * `globalThis.fetch` au moment de la requête — `$fetch`, `useFetch` et la session
 * (nuxt-auth-utils) passent donc tous par ici. Les requêtes vers une autre origine
 * ne sont pas modifiées.
 */
export default defineNuxtPlugin({
  name: 'colombe-i18n',
  enforce: 'pre',
  setup(nuxtApp) {
    applyLocale(resolveLocale(readStoredLanguage() ?? 'auto', browserLanguages(), 'fr'))
    nuxtApp.vueApp.use(i18n)

    const nativeFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(target, window.location.href).origin !== window.location.origin) return nativeFetch(input, init)
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (!headers.has('accept-language')) headers.set('Accept-Language', currentLocale())
      return nativeFetch(input, { ...init, headers })
    }
  },
})
