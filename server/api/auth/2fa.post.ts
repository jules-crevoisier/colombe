import { z } from 'zod'
import type { LoginResult } from '#shared/types/mail'
import { consumePending, failPending, peekPending } from '../../lib/auth/pending'
import { verifySecondFactor } from '../../lib/auth/second-factor'
import { credentialsStore } from '../../lib/session/credentials'
import { loginLimiter } from '../../lib/session/rate-limit'
import { useDb } from '../../lib/store/db'
import { recordLoginEvent } from '../../lib/store/activity'
import { clientIp, logSafe } from '../../utils/mail-session'

const bodySchema = z.object({ code: z.string().trim().min(6).max(32) })

/** Étape 2 de la connexion : code TOTP ou code de secours. */
export default defineEventHandler(async (event): Promise<LoginResult> => {
  const { code } = await readValidatedBody(event, b => bodySchema.parse(b))
  const session = await getUserSession(event)
  const pendingId = session.secure?.pendingId
  const pending = pendingId ? peekPending(pendingId) : null
  if (!pendingId || !pending) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Connexion expirée', message: 'La connexion a expiré. Saisissez à nouveau votre mot de passe.' })
  }

  const emailKey = `email:${pending.email}`
  if (loginLimiter.isLimited(emailKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives', message: 'Trop de tentatives. Réessayez dans quelques minutes.' })
  }

  const ip = clientIp(event)
  const userAgent = getRequestHeader(event, 'user-agent') ?? ''

  if (!verifySecondFactor(useDb(), pending.email, code, { requireEnabled: true, allowRecovery: true })) {
    loginLimiter.hit(emailKey)
    // Authentification définitivement échouée : c'est ici, pas à /api/auth/login, que la
    // double authentification tranche succès/échec (voir ROADMAP R2.6).
    recordLoginEvent(useDb(), pending.email, ip, userAgent, false)
    // Une ligne par échec, pour fail2ban (voir docs/admin/configuration.md).
    console.warn(`[colombe] auth-failure ip=${logSafe(ip)} user=${logSafe(pending.email)}`)
    if (failPending(pendingId)) {
      await clearUserSession(event)
      throw createError({ statusCode: 401, statusMessage: 'Code refusé', message: 'Trop de codes incorrects. Reconnectez-vous.' })
    }
    throw createError({ statusCode: 401, statusMessage: 'Code refusé', message: 'Code incorrect.' })
  }

  const creds = consumePending(pendingId)
  if (!creds) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Connexion expirée', message: 'La connexion a expiré. Saisissez à nouveau votre mot de passe.' })
  }
  loginLimiter.reset(emailKey)
  recordLoginEvent(useDb(), creds.email, ip, userAgent, true)
  const sid = credentialsStore.create(creds.email, creds.auth, ip, userAgent, creds.sso)
  await replaceUserSession(event, {
    user: { email: creds.email },
    secure: { sid },
    loggedInAt: Date.now(),
    // Connexion unique OIDC suivie du code Colombe : la session reste une session SSO.
    ...(creds.sso ? { authMethod: 'oidc' as const } : {}),
  })
  return { user: { email: creds.email } }
})
