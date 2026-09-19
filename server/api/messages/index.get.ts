import { z } from 'zod'
import type { MessagePage, SearchField, SortKey, MessageSummary } from '#shared/types/mail'
import type { ListOptions } from '../../lib/mail/backend'
import { requireMail, mailError } from '../../utils/mail-session'
import { withServerTiming } from '../../utils/server-timing'
import { serverT } from '../../lib/i18n'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

/** Nombre de résultats fusionnés max en scope=all (R1.2), et taille de page par dossier interrogé. */
const ALL_SCOPE_CAP = 200

const querySchema = z.object({
  folder: z.string().min(1).max(512).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  q: z.string().max(200).optional(),
  fields: z.string().optional().transform((v) => {
    if (!v) return undefined
    return v.split(',').filter((f): f is SearchField => ['subject', 'from', 'to', 'cc', 'body'].includes(f))
  }),
  scope: z.enum(['folder', 'all']).default('folder'),
  unread: z.coerce.boolean().optional(),
  flagged: z.coerce.boolean().optional(),
  unanswered: z.coerce.boolean().optional(),
  attachments: z.coerce.boolean().optional(),
  since: z.string().refine(v => datePattern.test(v), 'Format invalide: AAAA-MM-JJ').optional(),
  before: z.string().refine(v => datePattern.test(v), 'Format invalide: AAAA-MM-JJ').optional(),
  sort: z.enum(['date', 'from', 'subject', 'size']).default('date') as z.ZodType<SortKey>,
  order: z.enum(['asc', 'desc']).default('desc'),
})

function compareMessages(a: MessageSummary, b: MessageSummary, sort: SortKey): number {
  switch (sort) {
    case 'subject':
      return a.subject.localeCompare(b.subject, 'fr', { sensitivity: 'base' })
    case 'from':
      return (a.from?.address ?? '').localeCompare(b.from?.address ?? '')
    case 'size':
      return a.size - b.size
    default:
      return new Date(a.date).getTime() - new Date(b.date).getTime()
  }
}

export default defineEventHandler(async (event): Promise<MessagePage> => {
  return withServerTiming(event, 'messages', async () => {
    try {
      const query = await getValidatedQuery(event, body => querySchema.parse(body))
      const { backend } = await requireMail(event)

      const filters: NonNullable<ListOptions['filters']> = {}
      if (query.unread !== undefined) filters.unread = query.unread
      if (query.flagged !== undefined) filters.flagged = query.flagged
      if (query.unanswered !== undefined) filters.unanswered = query.unanswered
      if (query.attachments !== undefined) filters.attachments = query.attachments
      if (query.since) filters.since = query.since
      if (query.before) filters.before = query.before
      const filtersOpt = Object.keys(filters).length > 0 ? filters : undefined

      if (query.scope === 'folder') {
        if (!query.folder) {
          throw createError({ statusCode: 400, statusMessage: 'Dossier requis', message: serverT(event, 'messages.folderRequiredForSearch') })
        }
        // Un seul appel : le backend pagine, trie et filtre lui-même (jamais 5000 messages en mémoire).
        const result = await backend.listMessages(query.folder, {
          page: query.page,
          pageSize: query.pageSize,
          query: query.q,
          fields: query.fields,
          filters: filtersOpt,
          sort: query.sort,
          order: query.order,
        })
        return {
          items: result.items,
          total: result.total,
          page: query.page,
          pageSize: query.pageSize,
        }
      }

      // scope=all : un seul listFolders, puis page 1 (pageSize plafonné) par dossier éligible —
      // jamais de bodyStructure/preview au-delà des ALL_SCOPE_CAP résultats finaux.
      const folders = await backend.listFolders()
      const folderPaths = folders
        .filter(f => f.specialUse !== 'trash' && f.specialUse !== 'junk')
        .map(f => f.path)

      const allItems: MessageSummary[] = []
      for (const folder of folderPaths) {
        const result = await backend.listMessages(folder, {
          page: 1,
          pageSize: ALL_SCOPE_CAP,
          query: query.q,
          fields: query.fields,
          filters: filtersOpt,
          sort: query.sort,
          order: query.order,
        })
        allItems.push(...result.items)
      }

      allItems.sort((a, b) => (query.order === 'desc' ? -1 : 1) * compareMessages(a, b, query.sort))
      if (allItems.length > ALL_SCOPE_CAP) allItems.splice(ALL_SCOPE_CAP)

      const total = allItems.length
      const start = (query.page - 1) * query.pageSize
      const end = start + query.pageSize
      const pageItems = allItems.slice(start, end)

      return {
        items: pageItems,
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch (err: unknown) {
      throw mailError(err, event)
    }
  })
})
