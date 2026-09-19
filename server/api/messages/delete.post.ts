import { z } from 'zod'
import { listUserFolders } from '../../lib/mail/user-folders'
import { mailError, requireMail } from '../../utils/mail-session'
import { getPrefs } from '../../lib/store/prefs'
import { useDb } from '../../lib/store/db'

const bodySchema = z.object({
  folder: z.string().min(1).max(512),
  uids: z.array(z.number().int().positive()).min(1).max(500),
})

/**
 * Vers la Corbeille ; suppression définitive depuis la Corbeille (ou s'il n'y
 * en a pas), ou partout si `Prefs.deleteMode === 'permanent'` (R2.8).
 */
export default defineEventHandler(async (event) => {
  try {
    const { folder, uids } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { email, backend } = await requireMail(event)

    const prefs = getPrefs(useDb(), email)
    const trash = (await listUserFolders(backend, email)).find(f => f.specialUse === 'trash')
    if (!trash || trash.path === folder || prefs.deleteMode === 'permanent') await backend.expunge(folder, uids)
    else await backend.move(folder, uids, trash.path)

    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    throw mailError(err)
  }
})
