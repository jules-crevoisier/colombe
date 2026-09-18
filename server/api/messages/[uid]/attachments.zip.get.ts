import { z } from 'zod'
import { zipSync } from 'fflate'
import { parseMessage } from '../../../lib/mail/parse'
import { getAttachment } from '../../../lib/mail/parse'
import { mailError, requireMail } from '../../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const querySchema = z.object({
  folder: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const raw = await backend.getRawMessage(query.folder, uid)

    const msg = await backend.getMessage(query.folder, uid)
    const stored = await parseMessage(raw, {
      uid,
      folder: query.folder,
      seen: msg.seen,
      flagged: msg.flagged,
      size: msg.size,
      flags: msg.flags,
    })

    if (stored.attachments.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Pas de pièce jointe', message: 'Ce message n\'a pas de pièce jointe' })
    }

    const files: Record<string, Uint8Array> = {}
    const usedNames = new Set<string>()

    for (const att of stored.attachments) {
      const attachment = await getAttachment(raw, att.id)
      if (!attachment) continue

      let filename = attachment.filename
      if (usedNames.has(filename)) {
        const dotIdx = filename.lastIndexOf('.')
        if (dotIdx > 0) {
          const name = filename.substring(0, dotIdx)
          const ext = filename.substring(dotIdx)
          let i = 1
          while (usedNames.has(`${name}-${i}${ext}`)) i++
          filename = `${name}-${i}${ext}`
        } else {
          let i = 1
          while (usedNames.has(`${filename}-${i}`)) i++
          filename = `${filename}-${i}`
        }
      }
      usedNames.add(filename)
      files[filename] = attachment.content
    }

    const zip = zipSync(files)
    setHeader(event, 'Content-Type', 'application/zip')
    setHeader(event, 'Content-Disposition', 'attachment; filename="pieces-jointes.zip"')
    return Buffer.from(zip)
  } catch (err: unknown) {
    throw mailError(err)
  }
})
