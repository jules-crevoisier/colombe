import { z } from 'zod'
import { MailError } from '../../lib/mail/backend'
import { verifyCredentials } from '../../lib/mail/index'
import type { LoginResult } from '#shared/types/mail'
import { createPending } from '../../lib/auth/pending'
import { getConfig, normalizeLoginEmail } from '../../lib/config'
import { credentialsStore } from '../../lib/session/credentials'
import { useDb } from '../../lib/store/db'
import { isTwoFactorEnabled } from '../../lib/store/twofactor'
import { recordLoginEvent } from '../../lib/store/activity'
import { ipLoginLimiter, loginLimiter } from '../../lib/session/rate-limit'
import { clientIp, logSafe, mailConfig } from '../../utils/mail-session'

const loginSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
})

export default defineEventHandler(async (event): Promise<LoginResult> => {
  const config = getConfig()
  // Démo publique : les comptes dev/alice partagés ne doivent jamais être joignables
  // depuis Internet. Seul POST /api/auth/demo peut ouvrir une session en démo.
  if (config.demo.enabled) {
    throw createError({ statusCode: 403, statusMessage: 'Connexion désactivée', message: 'La connexion par mot de passe est désactivée dans la démo.' })
  }
  const body = await readValidatedBody(event, b => loginSchema.parse(b))
  const { kind, server } = mailConfig(event)

  const email = normalizeLoginEmail(body.email, config)
  if (!email) {
    if (!body.email.includes('@') && !config.login.defaultDomain) {
      throw createError({ statusCode: 400, statusMessage: 'Adresse incomplète', message: 'Saisissez votre adresse e-mail complète.' })
    }
    const domains = config.login.domains.map(d => `@${d}`).join(', ')
    throw createError({ statusCode: 403, statusMessage: 'Domaine refusé', message: `Seules les adresses ${domains} sont acceptées.` })
  }

  const ipKey = `ip:${clientIp(event)}`
  const emailKey = `email:${email}`
  if (ipLoginLimiter.isLimited(ipKey) || loginLimiter.isLimited(emailKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives', message: 'Trop de tentatives. Réessayez dans quelques minutes.' })
  }

  let valid: boolean
  try {
    valid = await verifyCredentials(kind, { email, password: body.password }, server)
  }
  catch (err) {
    // Serveur injoignable : ce n'est pas un échec d'authentification, on ne pénalise pas.
    const unavailable = err instanceof MailError && err.code === 'UNAVAILABLE'
    throw createError({
      statusCode: unavailable ? 503 : 500,
      statusMessage: 'Serveur de messagerie indisponible',
      message: 'Serveur de messagerie indisponible. Réessayez plus tard.',
    })
  }

  const ip = clientIp(event)
  const userAgent = getRequestHeader(event, 'user-agent') ?? ''

  if (!valid) {
    ipLoginLimiter.hit(ipKey)
    loginLimiter.hit(emailKey)
    recordLoginEvent(useDb(), email, ip, userAgent, false)
    // Une ligne par échec, pour fail2ban (voir docs/admin/CONFIGURATION.md).
    console.warn(`[colombe] auth-failure ip=${logSafe(ip)} user=${logSafe(email)}`)
    throw createError({ statusCode: 401, statusMessage: 'Identifiants incorrects', message: 'Adresse ou mot de passe incorrect.' })
  }

  // Second facteur activé : pas encore « authentifié » tant que le code n'est pas
  // vérifié (POST /api/auth/2fa se charge d'enregistrer succès/échec final).
  if (isTwoFactorEnabled(useDb(), email)) {
    const pendingId = createPending(email, body.password)
    await replaceUserSession(event, { secure: { pendingId } })
    return { twoFactorRequired: true }
  }

  loginLimiter.reset(emailKey)
  recordLoginEvent(useDb(), email, ip, userAgent, true)
  const sid = credentialsStore.create(email, body.password, ip, userAgent)
  // replaceUserSession régénère le cookie : protection contre la fixation de session.
  await replaceUserSession(event, { user: { email }, secure: { sid }, loggedInAt: Date.now() })
  return { user: { email } }
})
