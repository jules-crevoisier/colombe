import { z } from 'zod'
import { mailError, requireMail } from '../../utils/mail-session'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.array(z.number().int().positive()).min(1).max(500),
})

/** Vers la Corbeille ; suppression définitive seulement depuis la Corbeille (ou s'il n'y en a pas). */
export default defineEventHandler(async (event) => {
  try {
    const { folder, uids } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)

    const trash = (await backend.listFolders()).find(f => f.specialUse === 'trash')
    if (!trash || trash.path === folder) await backend.expunge(folder, uids)
    else await backend.move(folder, uids, trash.path)

    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    throw mailError(err)
  }
})
