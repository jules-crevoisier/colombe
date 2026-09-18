import { z } from 'zod'
import type { MessagePage } from '#shared/types/mail'
import { requireMail, mailError } from '../../utils/mail-session'

const querySchema = z.object({
  folder: z.string().min(1).max(512),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  q: z.string().max(200).optional(),
})

export default defineEventHandler(async (event): Promise<MessagePage> => {
  try {
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const result = await backend.listMessages(query.folder, {
      page: query.page,
      pageSize: query.pageSize,
      query: query.q,
    })

    return {
      items: result.items,
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    }
  } catch (err: unknown) {
    throw mailError(err)
  }
})
