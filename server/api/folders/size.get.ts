import { z } from 'zod'
import type { FolderSize } from '#shared/types/mail'
import { mailError, requireMail } from '../../utils/mail-session'

const querySchema = z.object({ path: z.string().min(1).max(512) })

/** Taille d'un dossier (R2.4) : octets + nombre de messages. */
export default defineEventHandler(async (event): Promise<FolderSize> => {
  try {
    const { path } = await getValidatedQuery(event, q => querySchema.parse(q))
    const { backend } = await requireMail(event)
    return await backend.folderSize(path)
  }
  catch (err) {
    throw mailError(err, event)
  }
})
