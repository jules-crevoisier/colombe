import { createI18n } from 'vue-i18n'
import type { AppLocale, LanguagePref } from '#shared/types/i18n'
import fr from '~/locales/fr'
import type { Messages } from '~/locales/fr'
import en from '~/locales/en'

export type { AppLocale, LanguagePref }

// Clés typées pour useI18n().t et $t : une clé inconnue fait échouer `pnpm typecheck`.
declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends Messages {}
}

/** Clé localStorage du choix de langue (confort par navigateur, jamais une donnée sensible). */
export const LANG_STORAGE_KEY = 'colombe.lang'

/**
 * Règle de pluriel française : 0 et 1 au singulier (« 0 message », « 1 message »),
 * contrairement à la règle par défaut de vue-i18n (0 au pluriel, correcte en anglais).
 * Trois formes (« aucun | un | plusieurs ») : zéro, un, plusieurs.
 */
function frenchPlural(choice: number, choicesLength: number): number {
  const n = Math.abs(choice)
  if (choicesLength === 2) return n > 1 ? 1 : 0
  return n === 0 ? 0 : n === 1 ? 1 : 2
}

/**
 * Instance unique, partagée par les composants (useI18n) et le code hors composant
 * (stores, utils : `i18n.global.t`). Le français est la langue source et de repli.
 * Messages embarqués dans le bundle : aucun chargement réseau de traductions.
 */
export const i18n = createI18n<[Messages], AppLocale, false>({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: { fr, en },
  pluralRules: { fr: frenchPlural },
  missingWarn: import.meta.dev ?? false,
  fallbackWarn: false,
  warnHtmlMessage: false,
})

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'fr' || value === 'en'
}

export function isLanguagePref(value: unknown): value is LanguagePref {
  return value === 'auto' || isAppLocale(value)
}

/** Première langue du navigateur commençant par « en » ou « fr », sinon la langue par défaut de l'établissement. */
export function detectLocale(languages: readonly string[], fallback: AppLocale): AppLocale {
  for (const lang of languages) {
    const tag = lang.toLowerCase()
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
    if (tag === 'fr' || tag.startsWith('fr-')) return 'fr'
  }
  return fallback
}

export function resolveLocale(pref: LanguagePref, languages: readonly string[], fallback: AppLocale): AppLocale {
  return pref === 'auto' ? detectLocale(languages, fallback) : pref
}

/**
 * Langue active « toutes sources confondues » : la préférence du compte (`auto` quand
 * personne n'est connecté), sinon le choix explicite fait sur ce navigateur (sélecteur
 * FR | EN de la page de connexion), sinon la langue du navigateur, sinon celle de
 * l'établissement.
 *
 * Une préférence de compte explicite (fr/en, choisie dans Paramètres) gagne toujours :
 * le choix mémorisé sur ce navigateur n'est consulté que tant que le compte est « auto ».
 */
export function resolveAppLocale(
  accountPref: LanguagePref,
  explicitChoice: AppLocale | null,
  languages: readonly string[],
  fallback: AppLocale,
): AppLocale {
  if (isAppLocale(accountPref)) return accountPref
  return resolveLocale(explicitChoice ?? 'auto', languages, fallback)
}

interface NavigatorLike {
  readonly languages?: readonly string[]
  readonly language?: string
}

function defaultNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator
}

/** Langues du navigateur, dans l'ordre de préférence. `nav` est injectable pour les tests. */
export function browserLanguages(nav: NavigatorLike | undefined = defaultNavigator()): readonly string[] {
  if (!nav) return []
  if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages
  return nav.language ? [nav.language] : []
}

/** Sous-ensemble de `Storage` utilisé ici (`window.localStorage`, ou un remplaçant de test). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  }
  catch {
    // Navigation privée, stockage bloqué.
    return undefined
  }
}

/**
 * Choix explicite fait sur ce navigateur (sélecteur FR | EN de la page de connexion, ou
 * recopié depuis une préférence de compte fr/en). `auto` n'est jamais stocké : son absence
 * (clé absente) *est* « auto ». `storage` est injectable pour les tests.
 */
export function readStoredLanguage(storage: StorageLike | undefined = defaultStorage()): AppLocale | null {
  try {
    const value = storage?.getItem(LANG_STORAGE_KEY) ?? null
    return isAppLocale(value) ? value : null
  }
  catch {
    return null
  }
}

export function storeLanguage(locale: AppLocale, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(LANG_STORAGE_KEY, locale)
  }
  catch {
    // Navigation privée, stockage bloqué : la langue reste celle de la session en cours.
  }
}

/** Efface le choix explicite (retour à « auto », § Paramètres → Général → « Automatique »). */
export function clearStoredLanguage(storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(LANG_STORAGE_KEY)
  }
  catch {
    // Navigation privée, stockage bloqué.
  }
}

export function currentLocale(): AppLocale {
  return i18n.global.locale.value
}

/** Change la langue active sans rechargement et met à jour `<html lang>`. */
export function applyLocale(locale: AppLocale): void {
  if (i18n.global.locale.value !== locale) i18n.global.locale.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

/**
 * Locale BCP 47 pour `Intl` (dates, nombres, tailles). En anglais, la variante du
 * navigateur (en-GB, en-US…) est respectée ; à défaut, en-GB.
 */
export function intlLocale(locale: AppLocale = currentLocale()): string {
  if (locale === 'fr') return 'fr-FR'
  const variant = browserLanguages().find(l => /^en-[a-z]{2}$/i.test(l))
  return variant ?? 'en-GB'
}
