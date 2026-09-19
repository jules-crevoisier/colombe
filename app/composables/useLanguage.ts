import type { AppLocale, LanguagePref } from '#shared/types/i18n'
import { applyLocale, browserLanguages, i18n, readStoredLanguage, resolveLocale, storeLanguage } from '~/lib/i18n'

/**
 * Choix de la langue active (appelé une fois, dans app.vue) :
 *   - connecté, préférences chargées : la préférence du compte gagne, et elle est
 *     recopiée dans `colombe.lang` pour que la page de connexion suive au prochain passage ;
 *   - sinon (connexion, double authentification, démo) : le choix mémorisé dans ce
 *     navigateur (sélecteur FR | EN), à défaut « auto ».
 * « auto » = première langue du navigateur en fr/en, sinon COLOMBE_DEFAULT_LANGUAGE.
 */
export function useLanguage() {
  const { config } = useSiteConfig()
  const { loggedIn } = useUserSession()
  const prefs = usePrefsStore()
  /** Choix fait sur la page de connexion pendant cette visite (réactif, contrairement à localStorage). */
  const localPref = useState<LanguagePref | null>('colombe-lang-local', () => readStoredLanguage())

  const pref = computed<LanguagePref>(() => {
    if (loggedIn.value && prefs.loaded) return prefs.prefs.language
    return localPref.value ?? 'auto'
  })

  const locale = computed<AppLocale>(() => resolveLocale(pref.value, browserLanguages(), config.value.defaultLanguage))

  watch(locale, applyLocale, { immediate: true })

  watch(() => (loggedIn.value && prefs.loaded ? prefs.prefs.language : null), (value) => {
    if (value === null) return
    storeLanguage(value)
    localPref.value = value
  }, { immediate: true })

  useHead({ htmlAttrs: { lang: locale } })

  return { locale, pref }
}

/** Sélecteur FR | EN de la page de connexion : langue mémorisée dans ce navigateur. */
export function useLoginLanguage() {
  const localPref = useState<LanguagePref | null>('colombe-lang-local', () => readStoredLanguage())
  const active = computed<AppLocale>(() => i18n.global.locale.value)

  function choose(locale: AppLocale): void {
    storeLanguage(locale)
    localPref.value = locale
  }

  return { active, choose }
}
