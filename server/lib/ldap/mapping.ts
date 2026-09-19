/**
 * Conversion d'une fiche LDAP (schéma SupAnn/eduPerson par-dessus inetOrgPerson) vers
 * `DirectoryEntry` (shared/types/mail.ts) : seuls les champs publics du contrat sont
 * conservés, jamais le DN ni un attribut brut non prévu.
 */
import type { LdapConfig } from '../config'
import type { DirectoryEntry } from '#shared/types/mail'

export type LdapAttributeValue = string | string[] | Buffer | Buffer[] | undefined

/** eduPersonPrimaryAffiliation (eduPerson) → libellé français. Valeur inconnue : passage tel quel. */
const AFFILIATION_LABELS: Record<string, string> = {
  student: 'Étudiant',
  staff: 'Personnel',
  faculty: 'Enseignant',
  employee: 'Personnel',
}

/** Première valeur d'un attribut LDAP potentiellement multi-valué, en chaîne. */
export function firstAttrValue(value: LdapAttributeValue): string | null {
  if (value === undefined) return null
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined) return null
  const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw
  const trimmed = str.trim()
  return trimmed || null
}

/** Premier token d'une affiliation potentiellement multi-valeur (`student;member` → `student`). */
function firstAffiliationToken(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split(/[;,]/)[0]?.trim()
  return first || null
}

/** eduPersonAffiliation peut porter plusieurs valeurs séparées par `;` selon l'annuaire. */
export function affiliationLabel(raw: string | null): string | null {
  const first = firstAffiliationToken(raw)
  if (!first) return null
  return AFFILIATION_LABELS[first.toLowerCase()] ?? first
}

/** true si l'affiliation brute est dans la liste LDAP_HIDE_AFFILIATIONS (déjà en minuscules). */
export function isHiddenAffiliation(raw: string | null, hideAffiliations: string[]): boolean {
  if (!hideAffiliations.length) return false
  const first = firstAffiliationToken(raw)
  return !!first && hideAffiliations.includes(first.toLowerCase())
}

/**
 * `null` si l'entrée n'a pas d'adresse mail exploitable (jamais renvoyée par l'API :
 * le filtrage par domaine se fait ensuite, côté appelant, sur ce champ `email`).
 */
export function mapLdapEntry(entry: Record<string, LdapAttributeValue>, attrs: LdapConfig['attrs']): DirectoryEntry | null {
  const email = firstAttrValue(entry[attrs.email])?.toLowerCase() ?? null
  if (!email) return null

  const name = firstAttrValue(entry[attrs.name]) ?? firstAttrValue(entry[attrs.nameFallback]) ?? email

  return {
    name,
    email,
    phone: firstAttrValue(entry[attrs.phone]),
    title: firstAttrValue(entry[attrs.title]),
    department: firstAttrValue(entry[attrs.department]),
    affiliation: affiliationLabel(firstAttrValue(entry[attrs.affiliation])),
  }
}
