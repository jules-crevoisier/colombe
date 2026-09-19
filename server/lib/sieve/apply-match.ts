/**
 * Évalue un `FilterRule` contre des `MessageSummary` déjà en mémoire, pour
 * `POST /api/filters/apply` (docs/PLAN-v4.md F.2 : « Appliquer aussi aux
 * messages existants »).
 *
 * `MessageSummary` ne porte pas tout ce que Sieve peut tester : pas de Cc, pas
 * d'en-tête arbitraire, pas de score de spam, et le corps n'est qu'un extrait
 * tronqué à 200 caractères (`preview`). Pour rester fidèle à la recherche
 * existante et ne jamais appliquer une action destructrice (« Supprimer »,
 * « Déplacer ») sur la foi d'une approximation :
 *
 *  - `from`, `to-cc`, `subject` : évalués sur les valeurs complètes du résumé
 *    (adresse/nom, sujet), quel que soit l'opérateur.
 *  - `to-cc` : seul le champ `to` est disponible (`MessageSummary` n'a pas de
 *    `cc`) — une correspondance sur un Cc seul est donc manquée. Documenté ici
 *    volontairement plutôt que deviné.
 *  - `body` avec `contains` / `not-contains` : délégué à la recherche du
 *    backend (`ListOptions.query` + `fields: ['body']`), qui teste le corps
 *    complet, pas l'extrait tronqué.
 *  - `body` avec un autre opérateur, `header`, `spam` : **non évalués**
 *    (« skip conservateur ») — la condition ne matche jamais. Une règle en
 *    « toutes les conditions » contenant l'une d'elles ne matche donc aucun
 *    message existant (aucune action n'est appliquée à tort) ; en
 *    « au moins une », elle ne contribue simplement pas.
 *  - `size` : comparé à `MessageSummary.size` (octets) contre la valeur en Ko.
 *  - `date` : comparé à `MessageSummary.date` (ISO) avec `before` / `after`.
 */
import type { Address, FilterCondition, FilterRule, MessageSummary } from '#shared/types/mail'

function normalize(value: string, caseSensitive?: boolean): string {
  return caseSensitive ? value : value.toLowerCase()
}

/** Traduit un motif Sieve (`*`, `?`) en expression régulière ancrée. */
function wildcardToRegExp(pattern: string, caseSensitive?: boolean): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, caseSensitive ? '' : 'i')
}

/** `true` pour les opérateurs de texte gérés ici (les autres retournent `undefined`, cf. buildTextTest). */
function textTest(op: FilterCondition['op'], value: string, target: string, caseSensitive?: boolean): boolean | undefined {
  const a = normalize(target, caseSensitive)
  const b = normalize(value, caseSensitive)
  switch (op) {
    case 'contains': return a.includes(b)
    case 'not-contains': return !a.includes(b)
    case 'is': return a === b
    case 'is-not': return a !== b
    case 'starts-with': return a.startsWith(b)
    case 'matches': return wildcardToRegExp(value, caseSensitive).test(target)
    default: return undefined
  }
}

function addressText(addr: Address | null, part: FilterCondition['addressPart']): string {
  if (!addr) return ''
  if (part === 'localpart') return addr.address.split('@')[0] ?? ''
  if (part === 'domain') return addr.address.split('@')[1] ?? ''
  return `${addr.name} <${addr.address}>`.trim()
}

/** Concatène nom + adresse de chaque destinataire `to` (pas de Cc dans `MessageSummary`, cf. en-tête). */
function toCcText(to: Address[], part: FilterCondition['addressPart']): string {
  return to.map(a => addressText(a, part)).join(' ; ')
}

function sizeTest(op: FilterCondition['op'], kbValue: string, sizeBytes: number): boolean {
  const kb = Number(kbValue)
  if (!Number.isFinite(kb)) return false
  const limitBytes = kb * 1024
  if (op === 'under') return sizeBytes < limitBytes
  return sizeBytes > limitBytes // 'over' et défaut
}

function dateTest(op: FilterCondition['op'], isoDay: string, messageDateIso: string): boolean {
  const day = messageDateIso.slice(0, 10)
  if (op === 'before') return day < isoDay
  if (op === 'after') return day > isoDay
  return false
}

/**
 * Évalue une condition contre un résumé, SAUF `body` en `contains` /
 * `not-contains` : ce cas dépend d'une recherche serveur externe et est
 * fourni via `bodyMatches` (ensemble d'UID déjà interrogé, voir apply.post.ts).
 */
function evaluateCondition(condition: FilterCondition, summary: MessageSummary, bodyMatches: Set<number> | null): boolean {
  switch (condition.field) {
    case 'from':
      return textTest(condition.op, condition.value, addressText(summary.from, condition.addressPart), condition.caseSensitive) ?? false
    case 'to-cc':
      return textTest(condition.op, condition.value, toCcText(summary.to, condition.addressPart), condition.caseSensitive) ?? false
    case 'subject':
      return textTest(condition.op, condition.value, summary.subject, condition.caseSensitive) ?? false
    case 'size':
      return sizeTest(condition.op, condition.value, summary.size)
    case 'date':
      return dateTest(condition.op, condition.value, summary.date)
    case 'body':
      if ((condition.op === 'contains' || condition.op === 'not-contains') && bodyMatches) {
        const inSet = bodyMatches.has(summary.uid)
        return condition.op === 'contains' ? inSet : !inSet
      }
      // Opérateur non fiable sur un simple extrait : jamais considéré comme satisfait.
      return false
    case 'header':
    case 'spam':
      // Non disponibles dans MessageSummary : jamais considérés comme satisfaits.
      return false
    default:
      return false
  }
}

/** `true` si `summary` satisfait `rule` (conditions vides = tous les messages, PLAN-v4 F). */
export function matchesRule(rule: FilterRule, summary: MessageSummary, bodyMatches: Set<number> | null): boolean {
  if (rule.conditions.length === 0) return true
  const results = rule.conditions.map(c => evaluateCondition(c, summary, bodyMatches))
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/** La règle a-t-elle une condition `body` avec `contains`/`not-contains` (nécessite une recherche serveur) ? */
export function needsBodySearch(rule: FilterRule): string | null {
  const c = rule.conditions.find(c => c.field === 'body' && (c.op === 'contains' || c.op === 'not-contains'))
  return c ? c.value : null
}
