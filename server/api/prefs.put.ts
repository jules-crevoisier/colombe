import { z } from 'zod'
import { savePrefs } from '../lib/store/prefs'
import { OutgoingImageError } from '../lib/mail/sanitize-outgoing'
import { requireMail } from '../utils/mail-session'
import { useDb } from '../lib/store/db'
import type { Prefs } from '#shared/types/mail'
import { localizedErrorMessage } from '../lib/i18n'

const specialFoldersSchema = z.object({
  sent: z.string().max(512),
  drafts: z.string().max(512),
  trash: z.string().max(512),
  junk: z.string().max(512),
  archive: z.string().max(512),
}).strict()

// Strict : toute clé absente de `Prefs` est refusée (400), comme l'exige le contrat R2.8.
const updateSchema = z.object({
  signatureHtml: z.string().max(1_000_000).optional(),
  signatureEnabled: z.boolean().optional(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]).optional(),
  conversationView: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
  readingPane: z.enum(['none', 'right']).optional(),
  markReadDelay: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(-1)]).optional(),
  preferHtml: z.boolean().optional(),
  remoteImages: z.enum(['never', 'contacts', 'always']).optional(),
  timeZone: z.string().min(1).max(100).optional(),
  dateFormat: z.enum(['relative', 'short', 'long']).optional(),
  timeFormat: z.enum(['24h', '12h']).optional(),
  replyPosition: z.enum(['above', 'below']).optional(),
  composeHtml: z.boolean().optional(),
  logoutEmptyTrash: z.boolean().optional(),
  logoutExpunge: z.boolean().optional(),
  deleteMode: z.enum(['trash', 'permanent']).optional(),
  specialFolders: specialFoldersSchema.optional(),
  idleMinutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]).optional(),
  threadList: z.boolean().optional(),
  welcomed: z.boolean().optional(),
  language: z.enum(['auto', 'fr', 'en']).optional(),
}).strict()

export default defineEventHandler(async (event): Promise<Prefs> => {
  try {
    const { email } = await requireMail(event)
    const db = useDb()
    const body = await readValidatedBody(event, b => updateSchema.parse(b))
    return savePrefs(db, email, body as Partial<Prefs>)
  }
  catch (err) {
    if (err instanceof OutgoingImageError) throw createError({ statusCode: 400, statusMessage: 'Image invalide', message: localizedErrorMessage(event, err) })
    throw err
  }
})
