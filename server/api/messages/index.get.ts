import { z } from 'zod'
import type { MessagePage, SearchField, SortKey, MessageSummary } from '#shared/types/mail'
import { requireMail, mailError } from '../../utils/mail-session'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

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

export default defineEventHandler(async (event): Promise<MessagePage> => {
  try {
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const folders = await backend.listFolders()
    let folderPaths: string[]

    if (query.scope === 'all') {
      folderPaths = folders
        .filter(f => f.specialUse !== 'trash' && f.specialUse !== 'junk')
        .map(f => f.path)
    } else {
      if (!query.folder) {
        throw createError({ statusCode: 400, statusMessage: 'Dossier requis', message: 'Dossier requis pour cette recherche' })
      }
      folderPaths = [query.folder]
    }

    const filters: Record<string, unknown> = {}
    if (query.unread !== undefined) filters.unread = query.unread
    if (query.flagged !== undefined) filters.flagged = query.flagged
    if (query.unanswered !== undefined) filters.unanswered = query.unanswered
    if (query.attachments !== undefined) filters.attachments = query.attachments
    if (query.since) filters.since = query.since
    if (query.before) filters.before = query.before

    const allItems: Array<MessageSummary & { folder: string }> = []
    for (const folder of folderPaths) {
      const result = await backend.listMessages(folder, {
        page: 1,
        pageSize: 5000,
        query: query.q,
        fields: query.fields,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        sort: query.sort,
        order: query.order,
      })
      for (const item of result.items) {
        allItems.push({ ...item, folder })
      }
    }

    if (query.scope === 'all' && allItems.length > 200) {
      allItems.splice(200)
    }

    const total = allItems.length
    const start = (query.page - 1) * query.pageSize
    const end = start + query.pageSize
    const pageItems = allItems.slice(start, end)

    return {
      items: pageItems as MessageSummary[],
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  } catch (err: unknown) {
    throw mailError(err)
  }
})
