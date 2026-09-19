import { z } from 'zod'
import { credentialsStore, hashSessionId } from '../../../lib/session/credentials'
import { backendPool } from '../../../lib/session/pool'
import { requireMail } from '../../../utils/mail-session'

const paramsSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}$/, 'Identifiant de session invalide'),
})

/** Déconnecte une session précise (empreinte à 8 caractères hexadécimaux, jamais le sid). */
export default defineEventHandler(async (event): Promise<null> => {
  const { email } = await requireMail(event)
  const { id } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))

  const target = credentialsStore.listByOwner(email).find(s => hashSessionId(s.sid) === id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Session introuvable', message: 'Session introuvable.' })
  }

  credentialsStore.delete(target.sid)
  await backendPool.delete(target.sid)

  setResponseStatus(event, 204)
  return null
})
