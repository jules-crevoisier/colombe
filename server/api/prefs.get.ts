import { getPrefs } from '../lib/store/prefs'
import { requireMail } from '../utils/mail-session'
import { withServerTiming } from '../utils/server-timing'
import { useDb } from '../lib/store/db'
import type { Prefs } from '#shared/types/mail'

export default defineEventHandler(async (event): Promise<Prefs> => {
  return withServerTiming(event, 'prefs', async () => {
    const { email } = await requireMail(event)
    const db = useDb()
    return getPrefs(db, email)
  })
})
