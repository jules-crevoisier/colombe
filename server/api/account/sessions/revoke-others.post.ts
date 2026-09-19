import { credentialsStore } from '../../../lib/session/credentials'
import { backendPool } from '../../../lib/session/pool'
import { sievePool } from '../../../lib/session/sieve-pool'
import { requireMail } from '../../../utils/mail-session'

/** Déconnecte toutes les sessions de l'utilisateur sauf la session courante (R2.6). */
export default defineEventHandler(async (event): Promise<null> => {
  const { email, sid } = await requireMail(event)

  const others = credentialsStore.listByOwner(email).filter(s => s.sid !== sid)
  for (const other of others) {
    credentialsStore.delete(other.sid)
    await backendPool.delete(other.sid)
    await sievePool.delete(other.sid)
  }

  setResponseStatus(event, 204)
  return null
})
