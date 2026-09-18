import { resetMockStore } from '../../lib/mail/mock'
import { ipLoginLimiter, loginLimiter, sendLimiter } from '../../lib/session/rate-limit'
import { useDb } from '../../lib/store/db'

/**
 * Réinitialise le jeu de données (tests). N'existe qu'avec MAIL_BACKEND=mock,
 * backend lui-même interdit en production (plugin startup-guard).
 */
export default defineEventHandler((event) => {
  if (useRuntimeConfig(event).mail.backend !== 'mock') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  resetMockStore()
  for (const limiter of [loginLimiter, ipLoginLimiter, sendLimiter]) limiter.clear()
  useDb().exec('DELETE FROM totp; DELETE FROM recovery_codes; DELETE FROM prefs; DELETE FROM contacts;')
  setResponseStatus(event, 204)
  return null
})
