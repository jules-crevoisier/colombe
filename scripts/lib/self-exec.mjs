/**
 * Les CLI admin importent server/lib/config/index.ts (et parfois server/lib/store/db.ts,
 * server/lib/contacts/vcard.ts) directement en .ts, en s'appuyant sur le "type stripping"
 * natif de Node 24. Mais server/lib/config/index.ts utilise une propriété de paramètre
 * TypeScript (`constructor(public readonly problems: string[])`), une syntaxe NON
 * effaçable que le mode par défaut de Node ("strip-only") refuse avec
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Le flag `--experimental-transform-types` la
 * transforme correctement. On ne peut pas changer les flags d'un process Node déjà
 * démarré : on se relance donc une fois avec ce flag avant de faire quoi que ce soit.
 *
 * Zéro dépendance (node:child_process uniquement) : fonctionne aussi dans l'archive de
 * release, sans pnpm ni node_modules.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve as resolvePath } from 'node:path'

const RELAUNCH_MARKER = '__COLOMBE_CLI_RELAUNCHED__'

/**
 * true si ce module est le point d'entrée du process (`node scripts/xxx.mjs`), false
 * s'il a été importé (ex. par les tests, pour réutiliser ses fonctions pures) — dans ce
 * second cas on ne veut ni relaunch, ni exécution de `main()`.
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

/**
 * À appeler tout en haut du point d'entrée d'une CLI, avant tout import de fichier .ts.
 * Ne retourne jamais si un relaunch a lieu (le process se termine avec le code de l'enfant).
 */
export function ensureTypeScriptSupport() {
  if (process.env[RELAUNCH_MARKER] === '1') return

  const scriptPath = process.argv[1]
  const extraArgs = process.argv.slice(2)
  if (!scriptPath) return

  const result = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', scriptPath, ...extraArgs],
    {
      stdio: 'inherit',
      env: { ...process.env, [RELAUNCH_MARKER]: '1' },
    }
  )

  if (result.error) {
    console.error(`Impossible de relancer Node avec --experimental-transform-types : ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}
