import { z } from 'zod'
import { mailError, requireMail } from '../../utils/mail-session'
import { serverT } from '../../lib/i18n'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
})

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)

    // Only allow emptying trash or junk folders
    const folders = await backend.listFolders()
    const folder = folders.find(f => f.path === body.folder)
    if (!folder || (folder.specialUse !== 'trash' && folder.specialUse !== 'junk')) {
      throw createError({ statusCode: 400, statusMessage: 'Opération non autorisée', message: serverT(event, 'folders.emptyOnlyTrashSpam') })
    }

    const uids = await backend.allUids(body.folder)

    // Expunge all messages in batches of 500
    const batchSize = 500
    for (let i = 0; i < uids.length; i += batchSize) {
      const batch = uids.slice(i, i + batchSize)
      await backend.expunge(body.folder, batch)
    }

    setResponseStatus(event, 204)
    return null
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
