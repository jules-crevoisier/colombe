import type { ActiveSession } from '#shared/types/mail'
import { credentialsStore, hashSessionId } from '../../../lib/session/credentials'
import { requireMail } from '../../../utils/mail-session'

export default defineEventHandler(async (event): Promise<ActiveSession[]> => {
  const { email, sid } = await requireMail(event)
  return credentialsStore.listByOwner(email).map(s => ({
    id: hashSessionId(s.sid),
    createdAt: new Date(s.createdAt).toISOString(),
    lastSeenAt: new Date(s.lastSeen).toISOString(),
    ip: s.ip,
    userAgent: s.userAgent,
    current: s.sid === sid,
  }))
})
