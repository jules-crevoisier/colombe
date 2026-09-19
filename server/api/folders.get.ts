import { z } from 'zod'
import type { Folder, SpecialUse } from '#shared/types/mail'
import { getPrefs } from '../lib/store/prefs'
import { useDb } from '../lib/store/db'
import { applySpecialFolderOverrides } from '../lib/mail/folder-names'
import { mailError, requireMail } from '../utils/mail-session'
import { withServerTiming } from '../utils/server-timing'

const ORDER: SpecialUse[] = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']

const querySchema = z.object({ all: z.coerce.boolean().optional() })

function rank(f: Folder): number {
  return f.specialUse ? ORDER.indexOf(f.specialUse) : ORDER.length
}

export default defineEventHandler(async (event): Promise<Folder[]> => {
  return withServerTiming(event, 'folders', async () => {
    try {
      const { email, backend } = await requireMail(event)
      const { all } = await getValidatedQuery(event, q => querySchema.parse(q))
      const folders = await backend.listFolders({ all })
      const prefs = getPrefs(useDb(), email)
      const overridden = applySpecialFolderOverrides(folders, prefs.specialFolders)
      return overridden.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'))
    }
    catch (err) {
      throw mailError(err, event)
    }
  })
})
