/**
 * Construction du filtre LDAP envoyé à l'annuaire (RFC 4515). Toute valeur saisie par
 * l'utilisateur passe par `escapeFilterValue` avant d'être insérée dans un filtre : un
 * mot de recherche comme `*)(uid=*` ne doit jamais pouvoir élargir ou détourner le
 * filtre. Testé par tests/unit/ldap/directory.test.ts avec des vecteurs d'injection.
 *
 * Le caractère NUL est référencé via `String.fromCharCode(0)` plutôt qu'un échappement
 * Unicode littéral dans le code source (politique du dépôt : aucun octet de contrôle
 * brut dans les sources, voir tests/unit/policy/encoding.test.ts).
 */
const NUL = String.fromCharCode(0)

// RFC 4515 §3 : ces caractères doivent être échappés dans un filtre LDAP en chaîne,
// sous la forme \XX (le code hexadécimal de l'octet).
const SPECIAL: Record<string, string> = {
  '\\': '\\5c',
  '*': '\\2a',
  '(': '\\28',
  ')': '\\29',
}
SPECIAL[NUL] = '\\00'

/** Échappe une valeur destinée à apparaître dans un filtre LDAP (RFC 4515). */
export function escapeFilterValue(value: string): string {
  let out = ''
  for (const ch of value) out += SPECIAL[ch] ?? ch
  return out
}

/**
 * Filtre final envoyé au serveur : `(&<filtre de base>(|(attr=*mot1*)…)(|(attr=*mot2*)…))`
 * — un mot de la requête doit correspondre à au moins un attribut (OR), et tous les mots
 * doivent correspondre (AND). Chaque mot est échappé indépendamment.
 */
export function buildDirectoryFilter(query: string, searchAttrs: string[], baseFilter: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const wordClauses = words.map((word) => {
    const escaped = escapeFilterValue(word)
    const ors = searchAttrs.map(attr => `(${attr}=*${escaped}*)`).join('')
    return `(|${ors})`
  })
  return `(&${baseFilter}${wordClauses.join('')})`
}
