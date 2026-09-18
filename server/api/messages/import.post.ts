import { z } from 'zod'
import { mailError, requireMail } from '../../utils/mail-session'

const MAX_TOTAL_SIZE = 25 * 1024 * 1024 // 25 MB

function isValidMessage(raw: Buffer): boolean {
  const text = raw.toString('utf-8', 0, Math.min(4096, raw.length))
  const hasFrom = /^From:\s*\S+/im.test(text)
  const hasDate = /^Date:\s*\S+/im.test(text)
  const hasMessageId = /^Message-ID:\s*\S+/im.test(text)
  return hasFrom && (hasDate || hasMessageId)
}

export default defineEventHandler(async (event) => {
  try {
    const { backend } = await requireMail(event)

    // Validate folder parameter
    const formData = await readMultipartFormData(event)
    if (!formData) {
      throw createError({ statusCode: 400, statusMessage: 'Données invalides', message: 'Données multipart/form-data requises' })
    }

    const folderField = formData.find(f => f.name === 'folder')
    if (!folderField) {
      throw createError({ statusCode: 400, statusMessage: 'Paramètre manquant', message: 'Le champ "folder" est requis' })
    }

    const folder = typeof folderField.data === 'string' ? folderField.data : folderField.data.toString('utf-8')
    const folders = await backend.listFolders()
    if (!folders.find(f => f.path === folder)) {
      throw createError({ statusCode: 404, statusMessage: 'Dossier introuvable', message: `Le dossier ${folder} n'existe pas` })
    }

    let totalSize = 0
    let imported = 0

    for (const field of formData) {
      if (field.name === 'folder') continue
      if (!field.data || typeof field.data === 'string') continue

      const size = field.data.length
      totalSize += size

      if (totalSize > MAX_TOTAL_SIZE) {
        throw createError({ statusCode: 413, statusMessage: 'Trop volumineux', message: 'Import dépasse 25 Mo' })
      }

      // Validate that this looks like an email message
      if (isValidMessage(field.data as Buffer)) {
        await backend.append(folder, field.data as Buffer, ['\\Seen'])
        imported++
      }
    }

    setResponseStatus(event, 200)
    return { imported }
  } catch (err: unknown) {
    throw mailError(err)
  }
})
