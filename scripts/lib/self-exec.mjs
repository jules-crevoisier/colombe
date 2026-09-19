/**
 * Les CLI admin importent directement des fichiers TypeScript du serveur
 * (server/lib/config/index.ts, server/lib/store/db.ts, server/lib/contacts/vcard.ts) :
 * Node 24 les exécute nativement (« type stripping »). Ces fichiers doivent donc rester
 * limités à une syntaxe effaçable (pas d'enum, pas de propriété de paramètre).
 */
import { fileURLToPath } from 'node:url'
import { resolve as resolvePath } from 'node:path'

/**
 * true si ce module est le point d'entrée du process (`node scripts/xxx.mjs`), false
 * s'il a été importé (ex. par les tests, pour réutiliser ses fonctions pures) : dans ce
 * second cas on n'exécute pas `main()`.
 */
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false
  try {
    return resolvePath(fileURLToPath(moduleUrl)) === resolvePath(process.argv[1])
  }
  catch {
    return false
  }
}
