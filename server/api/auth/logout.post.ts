import { credentialsStore } from '../../lib/session/credentials'
import { backendPool } from '../../lib/session/pool'
// clearUserSession, getUserSession are auto-imported by nuxt-auth-utils

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)

  if (session?.secure?.sid) {
    credentialsStore.delete(session.secure.sid)
    await backendPool.delete(session.secure.sid)
  }

  await clearUserSession(event)

  setResponseStatus(event, 204)
  return null
})
