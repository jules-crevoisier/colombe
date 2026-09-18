import { z } from 'zod'
import { zipSync } from 'fflate'
import { mailError, requireMail } from '../../utils/mail-session'

const querySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.string().transform((v) => {
    const uids = v.split(',').map(u => Number.parseInt(u, 10)).filter(u => Number.isSafeInteger(u) && u > 0)
    if (uids.length === 0 || uids.length > 200) return null
    return uids
  }).pipe(z.number().array().nonempty('Entre 1 et 200 UIDs requis').max(200)),
})

export default defineEventHandler(async (event) => {
  try {
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const files: Record<string, Uint8Array> = {}
    let totalSize = 0
    const maxSize = 100 * 1024 * 1024

    for (let i = 0; i < query.uids.length; i++) {
      const uid = query.uids[i]
      if (!uid) continue

      const raw = await backend.getRawMessage(query.folder, uid)
      totalSize += raw.length

      if (totalSize > maxSize) {
        throw createError({ statusCode: 400, statusMessage: 'Trop volumineux', message: 'Archive dépasse 100 Mo' })
      }

      let subject = 'message'
      try {
        const msg = await backend.getMessage(query.folder, uid)
        const raw_text = msg.raw.toString('utf-8', 0, Math.min(2048, msg.raw.length))
        const subjectMatch = raw_text.match(/^Subject:\s*([^\r\n]*)/im)
        if (subjectMatch?.[1]) {
          subject = subjectMatch[1].replace(/^=\?[^?]*\?[BQ]\?[^?]*\?=/g, '').trim() || 'message'
        }
      } catch {
        // Fallback to message index
      }

      const safe = subject
        .replace(/[/\\]/g, '_')
        .replace(/[\r\n]/g, '')
        .replace(/"/g, '')
        .substring(0, 120)

      const key = `${i}-${safe}.eml`
      files[key] = raw
    }

    const zip = zipSync(files)
    setHeader(event, 'Content-Type', 'application/zip')
    setHeader(event, 'Content-Disposition', 'attachment; filename="courrielle-messages.zip"')
    return Buffer.from(zip)
  } catch (err: unknown) {
    throw mailError(err)
  }
})
