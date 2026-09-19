/** Langues de l'interface. Le français est la langue source. */
export type AppLocale = 'fr' | 'en'

/** Préférence du compte : « auto » suit la langue du navigateur, puis la langue par défaut de l'établissement. */
export type LanguagePref = 'auto' | AppLocale

export const APP_LOCALES: readonly AppLocale[] = ['fr', 'en']
