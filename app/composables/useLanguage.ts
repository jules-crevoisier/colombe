import type { AppLocale, LanguagePref } from '#shared/types/i18n'
import { applyLocale, browserLanguages, clearStoredLanguage, i18n, isAppLocale, readStoredLanguage, resolveAppLocale, storeLanguage } from '~/lib/i18n'

/**
 * Choix de la langue active (appelé une fois, dans app.vue) : la préférence du compte
 * (fr/en) gagne toujours ; tant qu'elle vaut « auto » (pas de compte connu, ou compte
 * jamais réglé dans Paramètres), c'est le choix explicite fait sur ce navigateur
 * (sélecteur FR | EN de la page de connexion, `colombe.lang`) qui décide, sinon la langue
 * du navigateur, sinon celle de l'établissement (COLOMBE_DEFAULT_LANGUAGE).
 *
 * Une fois les préférences du compte connues (connexion par mot de passe, double
 * authentification, retour SSO, démo — toutes ramènent ici via la mise en page de la
 * messagerie) :
 *   - préférence de compte fr/en : elle gagne, et est recopiée dans `colombe.lang` pour
 *     que la page de connexion s'accorde au prochain passage — jamais l'inverse ;
 *   - préférence de compte « auto » et choix explicite sur ce navigateur : ce choix est
 *     à son tour enregistré comme préférence du compte, pour suivre l'utilisateur sur
 *     tous ses appareils.
 */
export function useLanguage() {
  const { config } = useSiteConfig()
  const { loggedIn } = useUserSession()
  const prefs = usePrefsStore()
  /** Choix fait sur la page de connexion pendant cette visite (réactif, contrairement à localStorage). */
  const localPref = useState<AppLocale | null>('colombe-lang-local', () => readStoredLanguage())

  const accountPref = computed<LanguagePref>(() => (loggedIn.value && prefs.loaded ? prefs.prefs.language : 'auto'))
  const locale = computed<AppLocale>(() => resolveAppLocale(accountPref.value, localPref.value, browserLanguages(), config.value.defaultLanguage))

  watch(locale, applyLocale, { immediate: true })

  watch(() => (loggedIn.value && prefs.loaded ? prefs.prefs.language : null), (value) => {
    if (value === null) return
    if (isAppLocale(value)) {
      // Préférence de compte explicite : elle gagne, et le navigateur s'y accorde.
      if (localPref.value !== value) {
        storeLanguage(value)
        localPref.value = value
      }
      return
    }
    // Compte « auto » : le choix fait sur ce navigateur (s'il existe) devient la
    // préférence du compte, en tâche de fond (pas de toast : rien n'a été « enregistré »
    // du point de vue de l'utilisateur, la langue affichée ne change pas).
    if (localPref.value) void prefs.save({ language: localPref.value }, { silent: true })
  }, { immediate: true })

  useHead({ htmlAttrs: { lang: locale } })

  return { locale, pref: accountPref }
}

/**
 * Écrit/efface le choix explicite mémorisé dans ce navigateur (`colombe.lang`) : utilisé
 * par le sélecteur FR | EN de la page de connexion (choose) et par Paramètres → Général →
 * Langue (choose pour Français/English, clear pour « Automatique »).
 */
export function useStoredLanguageChoice() {
  const localPref = useState<AppLocale | null>('colombe-lang-local', () => readStoredLanguage())

  function choose(locale: AppLocale): void {
    storeLanguage(locale)
    localPref.value = locale
  }

  function clear(): void {
    clearStoredLanguage()
    localPref.value = null
  }

  return { choose, clear }
}

/** Sélecteur FR | EN de la page de connexion : langue mémorisée dans ce navigateur. */
export function useLoginLanguage() {
  const { choose } = useStoredLanguageChoice()
  const active = computed<AppLocale>(() => i18n.global.locale.value)

  return { active, choose }
}
