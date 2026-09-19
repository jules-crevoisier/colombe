/**
 * POST /api/filters/apply : « Appliquer aussi aux messages existants »
 * (docs/dev/PLAN-v4.md F.2). Cherche dans la boîte de réception les messages qui
 * correspondent à `rule` (mêmes critères que la recherche, voir
 * server/lib/sieve/apply-match.ts) et applique uniquement des actions sûres
 * sur du courrier déjà livré : déplacer, copier, marquer comme lu, suivre,
 * supprimer. Jamais `redirect`, `notify`, `reject` ni `add-header` : seul le
 * courrier à venir passe par ces actions (le script Sieve généré ailleurs).
 */
import { z } from 'zod'
import type { FilterAction, FilterApplyResult } from '#shared/types/mail'
import { ruleSchema } from '../../lib/sieve/schemas'
import { matchesRule, needsBodySearch } from '../../lib/sieve/apply-match'
import { listUserFolders } from '../../lib/mail/user-folders'
import { getPrefs } from '../../lib/store/prefs'
import { useDb } from '../../lib/store/db'
import { requireMail, mailError } from '../../utils/mail-session'

const MAX_MESSAGES = 1000
const INBOX = 'INBOX'

const bodySchema = z.object({ rule: ruleSchema })

/**
 * Actions applicables au courrier déjà livré (jamais redirect/notify/reject/add-header/stop).
 * `FilterAction` regroupe plusieurs littéraux dans un même membre d'union
 * (`{ type: 'mark-read' | 'flag' | 'delete' | 'stop' }`) : un alias `Extract<...>`
 * sur un sous-ensemble de ces littéraux donnerait `never` (le membre entier doit
 * être assignable). On filtre donc sur la valeur de `type` sans alias de type,
 * et on renarrove au cas par cas dans les boucles ci-dessous.
 */
const ALLOWED_TYPES: ReadonlySet<FilterAction['type']> = new Set(['move', 'copy', 'mark-read', 'flag', 'delete'])

export default defineEventHandler(async (event): Promise<FilterApplyResult> => {
  try {
    const { rule } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email, backend } = await requireMail(event)

    const allowedActions = rule.actions.filter(a => ALLOWED_TYPES.has(a.type))
    if (allowedActions.length === 0) {
      // Aucune action sûre (ex. filtre uniquement "Rediriger vers") : rien à appliquer à l'existant.
      return { applied: 0 }
    }

    // Base de travail : jusqu'à MAX_MESSAGES messages de la boîte de réception, les plus récents d'abord.
    const base = await backend.listMessages(INBOX, { page: 1, pageSize: MAX_MESSAGES, sort: 'date', order: 'desc' })

    // Une condition "corps contient / ne contient pas" a besoin d'une vraie recherche
    // (le résumé ne porte qu'un extrait tronqué à 200 caractères) : on interroge le backend une fois.
    let bodyMatches: Set<number> | null = null
    const bodyNeedle = needsBodySearch(rule)
    if (bodyNeedle) {
      const bodyResult = await backend.listMessages(INBOX, {
        page: 1,
        pageSize: MAX_MESSAGES,
        query: bodyNeedle,
        fields: ['body'],
      })
      bodyMatches = new Set(bodyResult.items.map(m => m.uid))
    }

    const matched = base.items.filter(summary => matchesRule(rule, summary, bodyMatches)).slice(0, MAX_MESSAGES)
    if (matched.length === 0) {
      return { applied: 0 }
    }
    const uids = matched.map(m => m.uid)

    // Dossiers réels de l'utilisateur (respecte prefs.specialFolders) : sert à résoudre le dossier
    // Archives pour l'action « Ignorer la boîte de réception (archiver) » et à retrouver la Corbeille
    // pour « Supprimer » (même logique que /api/messages/delete).
    const folders = await listUserFolders(backend, email)
    const archiveFolder = folders.find(f => f.specialUse === 'archive')

    function resolveDestination(folder: string): string {
      if (archiveFolder && (folder === 'Archives' || folder.toLowerCase() === 'archive')) {
        return archiveFolder.path
      }
      return folder
    }

    // Ordre : les drapeaux d'abord (le message est encore dans INBOX), puis les changements
    // d'emplacement (copier, déplacer, supprimer) — si plusieurs sont présents, ils s'appliquent
    // dans l'ordre du filtre, ce qui peut rendre une action suivante sans effet (message déjà déplacé).
    const flagActions = allowedActions.filter(a => a.type === 'mark-read' || a.type === 'flag')
    const locationActions = allowedActions.filter(a => a.type === 'move' || a.type === 'copy' || a.type === 'delete')

    for (const action of flagActions) {
      if (action.type === 'mark-read') await backend.setFlags(INBOX, uids, { seen: true })
      else await backend.setFlags(INBOX, uids, { flagged: true })
    }

    const prefs = getPrefs(useDb(), email)
    const trash = folders.find(f => f.specialUse === 'trash')

    for (const action of locationActions) {
      if (action.type === 'copy') {
        await backend.copy(INBOX, uids, resolveDestination(action.folder))
      } else if (action.type === 'move') {
        await backend.move(INBOX, uids, resolveDestination(action.folder))
      } else if (action.type === 'delete') {
        if (!trash || prefs.deleteMode === 'permanent') await backend.expunge(INBOX, uids)
        else await backend.move(INBOX, uids, trash.path)
      }
    }

    return { applied: matched.length }
  } catch (err: unknown) {
    throw mailError(err)
  }
})
