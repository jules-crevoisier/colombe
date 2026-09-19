import { createError, isError } from 'h3'
import type { H3Error, H3Event } from 'h3'
import type { MailBackend, MailServerConfig } from '../lib/mail/backend'
import { MailError } from '../lib/mail/backend'
import type { BackendKind } from '../lib/mail/index'
import { getConfig } from '../lib/config'
import { freshCredentials } from '../lib/auth/oidc/session'
import { backendPool } from '../lib/session/pool'
import { serverT, translate } from '../lib/i18n'

export interface MailSession {
  email: string
  sid: string
  backend: MailBackend
}

export interface ResolvedMailConfig {
  kind: BackendKind
  server: MailServerConfig
}

/** Configuration mail résolue depuis server/lib/config (chargée au démarrage, pas au build). */
export function mailConfig(_event: H3Event): ResolvedMailConfig {
  const c = getConfig()
  return {
    kind: c.backend,
    server: {
      imapHost: c.imap.host,
      imapPort: c.imap.port,
      imapSecure: c.imap.secure,
      imapServername: c.imap.servername,
      smtpHost: c.smtp.host,
      smtpPort: c.smtp.port,
      smtpSecure: c.smtp.secure,
      smtpRequireTls: c.smtp.requireTls,
      smtpServername: c.smtp.servername,
      tlsRejectUnauthorized: c.tlsRejectUnauthorized,
      loginUsername: c.login.username,
      mailSso: c.mailSso,
    },
  }
}

/**
 * IP du client pour la limitation de débit. Derrière le reverse proxy Apache
 * (MAIL_TRUST_PROXY=true), on prend la DERNIÈRE valeur de X-Forwarded-For,
 * celle ajoutée par notre proxy ; les précédentes sont fournies par le client
 * et donc falsifiables.
 */
export function clientIp(event: H3Event): string {
  if (getConfig().trustProxy) {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')
    const last = forwarded?.split(',').map(s => s.trim()).filter(Boolean).at(-1)
    if (last) return last
  }
  return getRequestIP(event) ?? 'inconnue'
}

/** Retire retours à la ligne et espaces avant d'écrire une valeur dans les journaux (fail2ban). */
export function logSafe(value: string): string {
  return value.replace(/[\r\n\s]/g, '')
}

/**
 * Exige une session mail valide. Si le cookie scellé est valide mais que le
 * sid est inconnu (redémarrage du serveur, expiration), la session est effacée
 * et la requête reçoit un 401 : l'utilisateur doit se reconnecter.
 */
export async function requireMail(event: H3Event): Promise<MailSession> {
  const { user, secure } = await requireUserSession(event)
  // Session OIDC : jeton d'accès rafraîchi ici si besoin ; null si expiré sans renouvellement.
  const creds = secure?.sid ? await freshCredentials(secure.sid) : null

  if (!user?.email || !secure?.sid || !creds || creds.email !== user.email) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Session expirée', message: serverT(event, 'auth.sessionExpired') })
  }

  const { kind, server } = mailConfig(event)
  const backend = await backendPool.getOrCreate(secure.sid, kind, creds, server)
  return { email: user.email, sid: secure.sid, backend }
}

/**
 * Convertit une erreur en réponse HTTP sans fuite d'informations internes.
 * Les erreurs HTTP déjà formées (401, 400 de validation, 429…) sont conservées.
 * Message dans la langue de la requête (Accept-Language), statusMessage en français.
 */
export function mailError(err: unknown, event?: H3Event): H3Error {
  if (isError(err)) return err
  if (err instanceof MailError) {
    const map = {
      NOT_FOUND: [404, 'mail.notFound'],
      INVALID: [400, 'mail.invalid'],
      AUTH_FAILED: [401, 'mail.authFailed'],
      UNAVAILABLE: [503, 'mail.unavailable'],
    } as const
    const [statusCode, key] = map[err.code]
    return createError({ statusCode, statusMessage: translate('fr', key), message: serverT(event, key) })
  }
  console.error('[webmail] erreur inattendue', err instanceof Error ? err.name : typeof err)
  return createError({ statusCode: 500, statusMessage: 'Erreur serveur', message: serverT(event, 'server.error') })
}
