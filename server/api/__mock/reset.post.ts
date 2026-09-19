import { resetMockStore } from '../../lib/mail/mock'
import { ipLoginLimiter, loginLimiter, sendLimiter } from '../../lib/session/rate-limit'
import { resetSieveMock } from '../../lib/sieve/mock'
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
  resetSieveMock()
  for (const limiter of [loginLimiter, ipLoginLimiter, sendLimiter]) limiter.clear()
  // Toutes les données locales repartent de zéro (tables filles d'abord pour les clés étrangères).
  useDb().exec(`
    DELETE FROM contact_group_members; DELETE FROM contact_groups; DELETE FROM contact_emails;
    DELETE FROM contacts; DELETE FROM identities; DELETE FROM responses; DELETE FROM login_events;
    DELETE FROM totp; DELETE FROM recovery_codes; DELETE FROM prefs;
  `)
  setResponseStatus(event, 204)
  return null
})
