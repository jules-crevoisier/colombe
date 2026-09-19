import { z } from 'zod'
import type { Folder } from '#shared/types/mail'
import { MailError } from '../lib/mail/backend'
import { delimiterOf, folderNameSchema, rootPrefix } from '../lib/mail/folder-names'
import { mailError, requireMail } from '../utils/mail-session'
import { serverT } from '../lib/i18n'

const bodySchema = z.object({ name: folderNameSchema, parent: z.string().min(1).max(512).optional() })

export default defineEventHandler(async (event): Promise<Folder> => {
  try {
    const { name, parent } = await readValidatedBody(event, b => bodySchema.parse(b))
    const { backend } = await requireMail(event)
    const folders = await backend.listFolders({ all: true })
    const delimiter = delimiterOf(folders)
    if (name.includes(delimiter)) throw new MailError('INVALID', `Le nom ne peut pas contenir « ${delimiter} »`)
    if (parent && !folders.some(f => f.path === parent)) throw new MailError('NOT_FOUND', 'Dossier parent introuvable')

    const path = parent ? `${parent}${delimiter}${name}` : `${rootPrefix(folders)}${name}`
    if (folders.some(f => f.path.toLowerCase() === path.toLowerCase())) {
      throw createError({ statusCode: 409, statusMessage: 'Dossier existant', message: serverT(event, 'folders.exists') })
    }

    await backend.createFolder(path)
    const created = (await backend.listFolders()).find(f => f.path === path)
    if (!created) throw new MailError('UNAVAILABLE', 'Création non confirmée par le serveur')
    setResponseStatus(event, 201)
    return created
  }
  catch (err) {
    throw mailError(err, event)
  }
})
