/**
 * Garde-fous au démarrage : une mauvaise configuration ne doit jamais ouvrir
 * le webmail avec les comptes de test du backend mémoire.
 */
export default defineNitroPlugin(() => {
  const { mail, session } = useRuntimeConfig()
  const production = process.env.NODE_ENV === 'production'

  if (production && String((mail as { tlsRejectUnauthorized?: unknown }).tlsRejectUnauthorized) === 'false' && process.env.WEBMAIL_ALLOW_INSECURE_TLS !== '1') {
    throw new Error('[webmail] MAIL_TLS_REJECT_UNAUTHORIZED=false est interdit en production.')
  }
  if (production && mail.backend === 'mock' && process.env.WEBMAIL_ALLOW_MOCK !== '1') {
    throw new Error('[webmail] MAIL_BACKEND=mock est interdit en production.')
  }
  if (production && String(process.env.WEBMAIL_DATA_KEY ?? '').length < 32) {
    throw new Error('[webmail] WEBMAIL_DATA_KEY doit contenir au moins 32 caractères.')
  }
  if (production && String(session.password ?? '').length < 32) {
    throw new Error('[webmail] NUXT_SESSION_PASSWORD doit contenir au moins 32 caractères.')
  }
})
