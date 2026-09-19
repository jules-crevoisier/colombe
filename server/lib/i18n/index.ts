/**
 * Traduction des messages que le serveur adresse aux utilisateurs (erreurs de l'API,
 * e-mails composés par Colombe). Le client envoie `Accept-Language` = langue active
 * sur chaque appel ; sans en-tête (scripts, tests d'API), le français est conservé.
 * Les lignes de journal ne passent jamais par ici (format fail2ban inchangé).
 */
import type { H3Event } from 'h3'
import type { AppLocale } from '#shared/types/i18n'
import { getConfig } from '../config'
import fr from './fr'
import type { ServerMessageKey } from './fr'
import en from './en'

export type { ServerMessageKey }

/** Valeur d'une variable : texte, nombre, ou message lui-même traduit (ex. nom d'une fonctionnalité). */
export type ServerParam = string | number | LocalizedMessage
export type ServerParams = Record<string, ServerParam>

/** Message différé : clé + variables, traduit à la frontière HTTP quand la langue est connue. */
export interface LocalizedMessage {
  key: ServerMessageKey
  params?: ServerParams
}

const DICTIONARIES: Record<AppLocale, Record<ServerMessageKey, string>> = { fr, en }

/**
 * Première langue fr/en d'un en-tête Accept-Language, par ordre de préférence (q).
 * null si l'en-tête ne propose ni l'une ni l'autre.
 */
export function parseAcceptLanguage(header: string): AppLocale | null {
  const ranked = header.split(',')
    .map((part, index) => {
      const [tag = '', ...rest] = part.trim().split(';')
      const q = rest.map(p => p.trim()).find(p => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index }
    })
    .filter(r => r.tag && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  for (const { tag } of ranked) {
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
    if (tag === 'fr' || tag.startsWith('fr-')) return 'fr'
  }
  return null
}

/**
 * Langue d'une requête : en-tête absent → français (comportement historique de l'API) ;
 * présent sans fr/en → langue par défaut de l'établissement (COLOMBE_DEFAULT_LANGUAGE).
 */
export function requestLocale(event: H3Event | null | undefined): AppLocale {
  const header = acceptLanguage(event)
  if (!header) return 'fr'
  return parseAcceptLanguage(header) ?? getConfig().defaultLanguage
}

/** En-tête Accept-Language brut (lu sans dépendre du module h3 à l'exécution : testable seul). */
export function acceptLanguage(event: H3Event | null | undefined): string | undefined {
  const value = event?.node.req.headers['accept-language']
  return Array.isArray(value) ? value.join(',') : value
}

/** Message dans une langue donnée (e-mails composés hors requête). */
export function translate(locale: AppLocale, key: ServerMessageKey, params?: ServerParams): string {
  const template = DICTIONARIES[locale][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    if (value === undefined) return match
    return typeof value === 'object' ? translate(locale, value.key, value.params) : String(value)
  })
}

/** Message dans la langue de la requête (Accept-Language). */
export function serverT(event: H3Event | null | undefined, key: ServerMessageKey, params?: ServerParams): string {
  return translate(requestLocale(event), key, params)
}

/** Erreur métier portant un message traduisible (voir `localizedErrorMessage`). */
export interface LocalizableError {
  message: string
  i18n?: LocalizedMessage
}

/** Texte d'une erreur métier dans la langue de la requête ; à défaut, son message d'origine. */
export function localizedErrorMessage(event: H3Event | null | undefined, err: LocalizableError): string {
  return err.i18n ? serverT(event, err.i18n.key, err.i18n.params) : err.message
}

/** Texte français d'un message différé (message d'origine d'une erreur, inchangé). */
export function frenchText(message: LocalizedMessage): string {
  return translate('fr', message.key, message.params)
}
