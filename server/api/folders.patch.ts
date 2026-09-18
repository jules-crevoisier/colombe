import { z } from 'zod'
import { MailError } from '../lib/mail/backend'
import { folderNameSchema } from '../lib/mail/folder-names'
import { mailError, requireMail } from '../utils/mail-session'

const bodySchema = z.object({ path: z.string().min(1).max(512), name: folderNameSchema })

/** Renomme un dossier personnel en gardant son parent. */
export default defineEventHandler(async (event): Promise<{ path: string }> => {
  try {
    const { path, name } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)
    const folders = await backend.listFolders()
    const folder = folders.find(f => f.path === path)
    if (!folder) throw new MailError('NOT_FOUND', 'Dossier introuvable')
    if (folder.specialUse || path.toUpperCase() === 'INBOX') throw new MailError('INVALID', 'Ce dossier ne peut pas être renommé')
    if (name.includes(folder.delimiter)) throw new MailError('INVALID', `Le nom ne peut pas contenir « ${folder.delimiter} »`)

    const idx = path.lastIndexOf(folder.delimiter)
    const newPath = idx >= 0 ? `${path.slice(0, idx + folder.delimiter.length)}${name}` : name
    if (newPath === path) return { path }
    if (folders.some(f => f.path.toLowerCase() === newPath.toLowerCase())) {
      throw createError({ statusCode: 409, statusMessage: 'Dossier existant', message: 'Un dossier porte déjà ce nom.' })
    }
    await backend.renameFolder(path, newPath)
    return { path: newPath }
  }
  catch (err) {
    throw mailError(err)
  }
})
