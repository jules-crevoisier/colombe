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

export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages
  return navigator.language ? [navigator.language] : []
}

/** Choix mémorisé dans ce navigateur (sélecteur FR | EN de la page de connexion, ou préférence du compte). */
export function readStoredLanguage(): LanguagePref | null {
  try {
    const value = window.localStorage.getItem(LANG_STORAGE_KEY)
    return isLanguagePref(value) ? value : null
  }
  catch {
    return null
  }
}

export function storeLanguage(pref: LanguagePref): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, pref)
  }
  catch {
    // Navigation privée, stockage bloqué : la langue reste celle de la session en cours.
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
