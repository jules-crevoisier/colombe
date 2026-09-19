import { z } from 'zod'
import { mailError, requireMail } from '../../utils/mail-session'

const bodySchema = z.object({ path: z.string().min(1).max(512), subscribed: z.boolean() })

/** Abonne / désabonne un dossier (R2.4) — n'affecte que sa visibilité dans la barre latérale. */
export default defineEventHandler(async (event): Promise<null> => {
  try {
    const { path, subscribed } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)
    await backend.subscribeFolder(path, subscribed)
    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    throw mailError(err, event)
  }
})
