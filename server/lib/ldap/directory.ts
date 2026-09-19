/**
 * Orchestre une recherche dans l'annuaire de l'établissement : construction du filtre
 * (échappé), exécution LDAP avec une reconnexion, filtrage au domaine de
 * l'établissement (jamais une adresse hors domaine, même si l'annuaire en contient),
 * affiliations masquées (LDAP_HIDE_AFFILIATIONS), tri, cache 60 s.
 */
import { getLdapClient, resetLdapClient } from './client'
import { buildDirectoryFilter } from './escape'
import { firstAttrValue, isHiddenAffiliation, mapLdapEntry } from './mapping'
import type { LdapAttributeValue } from './mapping'
import { directorySearchCache, normalizeQueryKey } from './cache'
import type { LdapConfig } from '../config'
import type { DirectoryEntry } from '#shared/types/mail'

/** Erreur générique renvoyée par l'API (503) : jamais le message LDAP brut au client. */
export class DirectoryError extends Error {}

function attributesToFetch(attrs: LdapConfig['attrs']): string[] {
  return Array.from(new Set([attrs.name, attrs.nameFallback, attrs.email, attrs.phone, attrs.title, attrs.department, attrs.affiliation]))
}

async function runSearch(config: LdapConfig, filter: string): Promise<DirectoryEntry[]> {
  const client = await getLdapClient(config)
  const { searchEntries } = await client.search(config.baseDn, {
    scope: 'sub',
    filter,
    attributes: attributesToFetch(config.attrs),
    sizeLimit: config.maxResults + 1,
    timeLimit: Math.max(1, Math.round(config.timeoutMs / 1000)),
  })
  const entries: DirectoryEntry[] = []
  for (const raw of searchEntries) {
    const entry = raw as unknown as Record<string, LdapAttributeValue>
    const rawAffiliation = firstAttrValue(entry[config.attrs.affiliation])
    if (isHiddenAffiliation(rawAffiliation, config.hideAffiliations)) continue
    const mapped = mapLdapEntry(entry, config.attrs)
    if (mapped) entries.push(mapped)
  }
  return entries
}

/**
 * Recherche annuaire pour `query` (déjà validée : longueur ≥ LDAP_MIN_QUERY côté
 * appelant). `mailDomains` vient de la config mail (MAIL_DOMAINS), pas de la config
 * LDAP : c'est le dernier filet avant la réponse HTTP, aucune adresse hors domaine ne
 * doit jamais sortir de cette fonction.
 */
export async function searchDirectory(config: LdapConfig, mailDomains: string[], query: string): Promise<DirectoryEntry[]> {
  const cacheKey = normalizeQueryKey(query)
  const cached = directorySearchCache.get(cacheKey)
  if (cached) return cached

  const filter = buildDirectoryFilter(query, config.searchAttrs, config.filter)

  let entries: DirectoryEntry[]
  try {
    entries = await runSearch(config, filter)
  }
  catch (firstErr) {
    // Connexion périmée (redémarrage du serveur LDAP, coupure réseau) : une seule
    // reconnexion est tentée avant d'abandonner.
    resetLdapClient()
    try {
      entries = await runSearch(config, filter)
    }
    catch (err) {
      console.error('[webmail] recherche annuaire LDAP impossible', err instanceof Error ? err.message : err, firstErr instanceof Error ? firstErr.message : firstErr)
      throw new DirectoryError('Annuaire indisponible')
    }
  }

  const allowedDomains = new Set(mailDomains)
  const filtered = entries
    .filter(e => allowedDomains.has(e.email.slice(e.email.lastIndexOf('@') + 1)))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .slice(0, config.maxResults)

  directorySearchCache.set(cacheKey, filtered)
  return filtered
}
