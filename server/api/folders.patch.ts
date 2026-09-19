import { z } from 'zod'
import { MailError } from '../lib/mail/backend'
import { folderNameSchema, rootPrefix } from '../lib/mail/folder-names'
import { mailError, requireMail } from '../utils/mail-session'
import { serverT } from '../lib/i18n'

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  name: folderNameSchema.optional(),
  /** Déplace le dossier : chemin du nouveau parent, ou `null` pour la racine (R2.4). */
  parent: z.string().min(1).max(512).nullable().optional(),
})

/** Renomme et/ou déplace un dossier personnel (R2.4 : « Déplacer vers… »). */
export default defineEventHandler(async (event): Promise<{ path: string }> => {
  try {
    const { path, name, parent } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)
    const folders = await backend.listFolders({ all: true })
    const folder = folders.find(f => f.path === path)
    if (!folder) throw new MailError('NOT_FOUND', 'Dossier introuvable')
    if (folder.specialUse || path.toUpperCase() === 'INBOX') throw new MailError('INVALID', 'Ce dossier ne peut pas être modifié')

    const delimiter = folder.delimiter
    const newName = name ?? (path.includes(delimiter) ? (path.split(delimiter).pop() ?? path) : path)
    if (newName.includes(delimiter)) throw new MailError('INVALID', `Le nom ne peut pas contenir « ${delimiter} »`)

    let newParentPrefix: string
    if (parent === undefined) {
      // Parent inchangé.
      const idx = path.lastIndexOf(delimiter)
      newParentPrefix = idx >= 0 ? path.slice(0, idx + delimiter.length) : ''
    }
    else if (parent === null) {
      newParentPrefix = rootPrefix(folders)
    }
    else {
      const parentFolder = folders.find(f => f.path === parent)
      if (!parentFolder) throw new MailError('NOT_FOUND', 'Dossier parent introuvable')
      if (parent === path || parent.startsWith(`${path}${delimiter}`)) {
        throw new MailError('INVALID', 'Un dossier ne peut pas être déplacé dans lui-même')
      }
      newParentPrefix = `${parent}${delimiter}`
    }

    const newPath = `${newParentPrefix}${newName}`
    if (newPath === path) return { path }
    if (folders.some(f => f.path.toLowerCase() === newPath.toLowerCase())) {
      throw createError({ statusCode: 409, statusMessage: 'Dossier existant', message: serverT(event, 'folders.existsHere') })
    }

    await backend.renameFolder(path, newPath)
    return { path: newPath }
  }
  catch (err) {
    throw mailError(err, event)
  }
})
