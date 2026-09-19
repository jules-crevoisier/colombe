import type { H3Event } from 'h3'
import type { AppLocale } from '#shared/types/i18n'
import { getConfig } from '../config'
import { useDb } from '../store/db'
import { getPrefs } from '../store/prefs'
import { acceptLanguage, parseAcceptLanguage } from './index'

/**
 * Langue d'un e-mail composé par Colombe pour un compte (alerte de transfert, accusé
 * de lecture) : préférence du compte (fr/en) ; en « Automatique », la langue active
 * du navigateur qui a déclenché l'envoi (Accept-Language), sinon la langue par défaut
 * de l'établissement.
 */
export function accountLocale(event: H3Event | null | undefined, owner: string): AppLocale {
  const pref = getPrefs(useDb(), owner).language
  if (pref === 'fr' || pref === 'en') return pref
  const header = acceptLanguage(event)
  return (header ? parseAcceptLanguage(header) : null) ?? getConfig().defaultLanguage
}
