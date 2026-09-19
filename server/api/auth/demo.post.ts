import { randomUUID } from 'node:crypto'
import type { LoginResult } from '#shared/types/mail'
import { getConfig } from '../../lib/config'
import { demoAccounts } from '../../lib/demo/accounts'
import { demoLimiter } from '../../lib/session/rate-limit'
import { credentialsStore } from '../../lib/session/credentials'
import { clientIp } from '../../utils/mail-session'

/**
 * Démo publique (COLOMBE_DEMO=true) : crée un compte visiteur jetable
 * (`visiteur-<8 hex>@<domaine>`), seedé comme `dev`, et ouvre une session — sans
 * mot de passe, jamais joignable depuis Internet (POST /api/auth/login est
 * désactivé en démo). 404 hors démo : la route n'existe pas, comme /api/__mock/reset.
 */
export default defineEventHandler(async (event): Promise<LoginResult> => {
  const config = getConfig()
  if (!config.demo.enabled) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const ipKey = `ip:${clientIp(event)}`
  if (demoLimiter.isLimited(ipKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives', message: 'Trop de comptes de démonstration créés depuis cette adresse. Réessayez dans quelques minutes.' })
  }
  demoLimiter.hit(ipKey)

  const domain = config.login.domains[0] ?? 'universite.example'
  const email = demoAccounts.create(domain, config.demo.maxAccounts)

  const ip = clientIp(event)
  const userAgent = getRequestHeader(event, 'user-agent') ?? ''
  // Pas de mot de passe réel côté démo (le backend mémoire ne le revérifie jamais
  // après la création de session) : une valeur aléatoire suffit au stockage.
  const sid = credentialsStore.create(email, randomUUID(), ip, userAgent)
  // replaceUserSession régénère le cookie : même protection anti-fixation que /api/auth/login.
  await replaceUserSession(event, { user: { email }, secure: { sid }, loggedInAt: Date.now() })
  return { user: { email } }
})
