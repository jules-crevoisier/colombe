import { z } from 'zod'
import { MailError } from '../lib/mail/backend'
import { mailError, requireMail } from '../utils/mail-session'

const bodySchema = z.object({ path: z.string().min(1).max(512) })
const BATCH = 50

/**
 * Supprime un dossier personnel. Ses messages partent d'abord à la Corbeille :
 * rien n'est perdu sans passer par elle.
 */
export default defineEventHandler(async (event) => {
  try {
    const { path } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)
    const folders = await backend.listFolders()
    const folder = folders.find(f => f.path === path)
    if (!folder) throw new MailError('NOT_FOUND', 'Dossier introuvable')
    if (folder.specialUse || path.toUpperCase() === 'INBOX') throw new MailError('INVALID', 'Ce dossier ne peut pas être supprimé')
    if (folders.some(f => f.path.startsWith(`${path}${folder.delimiter}`))) {
      throw createError({ statusCode: 409, statusMessage: 'Sous-dossiers', message: 'Supprimez d’abord les sous-dossiers.' })
    }

    const trash = folders.find(f => f.specialUse === 'trash')
    if (trash) {
      // Toujours la page 1 : chaque déplacement vide le début de la liste.
      for (let guard = 0; guard < 10_000; guard++) {
        const { items } = await backend.listMessages(path, { page: 1, pageSize: BATCH })
        if (!items.length) break
        await backend.move(path, items.map(m => m.uid), trash.path)
      }
    }
    else if (folder.total > 0) {
      throw createError({ statusCode: 409, statusMessage: 'Dossier non vide', message: 'Videz ce dossier avant de le supprimer (aucune corbeille disponible).' })
    }

    await backend.deleteFolder(path)
    setResponseStatus(event, 204)
    return null
  }
  catch (err) {
    throw mailError(err)
  }
})
