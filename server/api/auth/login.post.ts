import { z } from 'zod'
import { MailError } from '../../lib/mail/backend'
import { verifyCredentials } from '../../lib/mail/index'
import type { LoginResult } from '#shared/types/mail'
import { createPending } from '../../lib/auth/pending'
import { credentialsStore } from '../../lib/session/credentials'
import { useDb } from '../../lib/store/db'
import { isTwoFactorEnabled } from '../../lib/store/twofactor'
import { recordLoginEvent } from '../../lib/store/activity'
import { ipLoginLimiter, loginLimiter } from '../../lib/session/rate-limit'
import { clientIp, mailConfig } from '../../utils/mail-session'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(1024),
})

export default defineEventHandler(async (event): Promise<LoginResult> => {
  const body = await readValidatedBody(event, b => loginSchema.parse(b))
  const { kind, server, allowedDomain } = mailConfig(event)

  if (!body.email.endsWith(`@${allowedDomain}`)) {
    throw createError({ statusCode: 403, statusMessage: 'Domaine refusé', message: `Seules les adresses @${allowedDomain} sont acceptées.` })
  }

  const ipKey = `ip:${clientIp(event)}`
  const emailKey = `email:${body.email}`
  if (ipLoginLimiter.isLimited(ipKey) || loginLimiter.isLimited(emailKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives', message: 'Trop de tentatives. Réessayez dans quelques minutes.' })
  }

  let valid: boolean
  try {
    valid = await verifyCredentials(kind, body, server)
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
    recordLoginEvent(useDb(), body.email, ip, userAgent, false)
    throw createError({ statusCode: 401, statusMessage: 'Identifiants incorrects', message: 'Adresse ou mot de passe incorrect.' })
  }

  // Second facteur activé : pas encore « authentifié » tant que le code n'est pas
  // vérifié (POST /api/auth/2fa se charge d'enregistrer succès/échec final).
  if (isTwoFactorEnabled(useDb(), body.email)) {
    const pendingId = createPending(body.email, body.password)
    await replaceUserSession(event, { secure: { pendingId } })
    return { twoFactorRequired: true }
  }

  loginLimiter.reset(emailKey)
  recordLoginEvent(useDb(), body.email, ip, userAgent, true)
  const sid = credentialsStore.create(body.email, body.password, ip, userAgent)
  // replaceUserSession régénère le cookie : protection contre la fixation de session.
  await replaceUserSession(event, { user: { email: body.email }, secure: { sid }, loggedInAt: Date.now() })
  return { user: { email: body.email } }
})
