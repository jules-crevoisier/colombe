import { z } from 'zod'
import { savePrefs } from '../lib/store/prefs'
import { requireMail } from '../utils/mail-session'
import { useDb } from '../lib/store/db'
import type { Prefs } from '#shared/types/mail'

const updateSchema = z.object({
  signatureHtml: z.string().max(10000).optional(),
  signatureEnabled: z.boolean().optional(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]).optional(),
  conversationView: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
}).strict()

export default defineEventHandler(async (event): Promise<Prefs> => {
  const { email } = await requireMail(event)
  const db = useDb()
  const body = await readValidatedBody(event, b => updateSchema.parse(b))
  return savePrefs(db, email, body as Partial<Prefs>)
})
