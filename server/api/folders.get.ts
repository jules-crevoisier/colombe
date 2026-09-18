import type { Folder, SpecialUse } from '#shared/types/mail'
import { mailError, requireMail } from '../utils/mail-session'

const ORDER: SpecialUse[] = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']

function rank(f: Folder): number {
  return f.specialUse ? ORDER.indexOf(f.specialUse) : ORDER.length
}

export default defineEventHandler(async (event): Promise<Folder[]> => {
  try {
    const { backend } = await requireMail(event)
    const folders = await backend.listFolders()
    return folders.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'))
  }
  catch (err) {
    throw mailError(err)
  }
})
