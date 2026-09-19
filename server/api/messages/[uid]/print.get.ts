import { z } from 'zod'
import { createHash } from 'node:crypto'
import { parseMessage } from '../../../lib/mail/parse'
import { buildPrintHtml } from '../../../lib/mail/print'
import { requestLocale } from '../../../lib/i18n'
import { mailError, requireMail } from '../../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const querySchema = z.object({
  folder: z.string().min(1).max(512),
  // Langue active de l'interface : la page est ouverte par un lien, sans Accept-Language de l'appli.
  lang: z.enum(['fr', 'en']).optional(),
})

export default defineEventHandler(async (event) => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const stored = await backend.getMessage(query.folder, uid)
    const msg = await parseMessage(stored.raw, {
      uid,
      folder: query.folder,
      seen: stored.seen,
      flagged: stored.flagged,
      size: stored.size,
      flags: stored.flags,
    })

    const html = buildPrintHtml(msg, query.lang ?? requestLocale(event))

    const printScript = 'window.print();'
    const scriptHash = createHash('sha256').update(printScript).digest('base64')

    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'Content-Security-Policy', `sandbox allow-scripts allow-modals; default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'`)

    return html
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
