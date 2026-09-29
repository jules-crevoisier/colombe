import type { AppLocale } from '#shared/types/i18n'
import fr from '../locales/fr'
import en from '../locales/en'

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

/** Options vue-i18n, partagées par @nuxtjs/i18n (i18n/i18n.config.ts) et les tests unitaires. */
export const i18nOptions = {
  legacy: false as const,
  locale: 'fr' as AppLocale,
  fallbackLocale: 'fr' as AppLocale,
  messages: { fr, en },
  pluralRules: { fr: frenchPlural },
  missingWarn: false,
  fallbackWarn: false,
  warnHtmlMessage: false,
}
