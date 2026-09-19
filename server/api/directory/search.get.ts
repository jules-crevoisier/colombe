import { z } from 'zod'
import { getConfig } from '../../lib/config'
import { DirectoryError, searchDirectory } from '../../lib/ldap/directory'
import { directorySearchLimiter } from '../../lib/session/rate-limit'
import { requireMail } from '../../utils/mail-session'
import type { DirectoryEntry } from '#shared/types/mail'
import { serverT } from '../../lib/i18n'

const querySchema = z.object({ q: z.string() })

/**
 * Recherche dans l'annuaire LDAP de l'établissement (docs/dev/PLAN — annuaire).
 * 404 quand LDAP_URL n'est pas configuré (comme /api/auth/demo hors démo) : la route
 * n'existe pas, plutôt qu'un 200 vide qui laisserait deviner la fonctionnalité.
 */
export default defineEventHandler(async (event): Promise<DirectoryEntry[]> => {
  const config = getConfig()
  if (!config.ldap) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const { sid } = await requireMail(event)

  const sessionKey = `session:${sid}`
  if (directorySearchLimiter.isLimited(sessionKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de requêtes', message: serverT(event, 'directory.tooMany') })
  }
  directorySearchLimiter.hit(sessionKey)

  const { q } = await getValidatedQuery(event, q => querySchema.parse(q))
  const query = q.trim()
  if (query.length < config.ldap.minQuery) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Requête trop courte',
      message: serverT(event, 'directory.queryTooShort', { min: config.ldap.minQuery }),
    })
  }

  try {
    return await searchDirectory(config.ldap, config.login.domains, query)
  }
  catch (err) {
    if (err instanceof DirectoryError) {
      throw createError({ statusCode: 503, statusMessage: 'Service indisponible', message: serverT(event, 'directory.unavailable') })
    }
    throw err
  }
})
