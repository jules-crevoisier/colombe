import { createError, isError } from 'h3'
import type { H3Error, H3Event } from 'h3'
import type { MailBackend, MailServerConfig } from '../lib/mail/backend'
import { MailError } from '../lib/mail/backend'
import type { BackendKind } from '../lib/mail/index'
import { credentialsStore } from '../lib/session/credentials'
import { backendPool } from '../lib/session/pool'

export interface MailSession {
  email: string
  sid: string
  backend: MailBackend
}

export interface ResolvedMailConfig {
  kind: BackendKind
  server: MailServerConfig
  allowedDomain: string
}

export function mailConfig(event: H3Event): ResolvedMailConfig {
  const c = useRuntimeConfig(event).mail
  const kind: BackendKind = c.backend === 'mock' ? 'mock' : 'imap'
  return {
    kind,
    allowedDomain: c.allowedDomain,
    server: {
      host: c.host,
      imapPort: Number(c.imapPort),
      imapSecure: c.imapSecure === true || String(c.imapSecure) === 'true',
      smtpPort: Number(c.smtpPort),
      smtpRequireTls: c.smtpRequireTls === true || String(c.smtpRequireTls) === 'true',
      tlsRejectUnauthorized: !(String((c as { tlsRejectUnauthorized?: unknown }).tlsRejectUnauthorized) === 'false'),
    },
  }
}

/**
 * IP du client pour la limitation de débit. Derrière le reverse proxy Apache
 * (NUXT_MAIL_TRUST_PROXY=true), on prend la DERNIÈRE valeur de X-Forwarded-For,
 * celle ajoutée par notre proxy ; les précédentes sont fournies par le client
 * et donc falsifiables.
 */
export function clientIp(event: H3Event): string {
  const trustProxy = String(useRuntimeConfig(event).mail.trustProxy) === 'true'
  if (trustProxy) {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')
    const last = forwarded?.split(',').map(s => s.trim()).filter(Boolean).at(-1)
    if (last) return last
  }
  return getRequestIP(event) ?? 'inconnue'
}

/**
 * Exige une session mail valide. Si le cookie scellé est valide mais que le
 * sid est inconnu (redémarrage du serveur, expiration), la session est effacée
 * et la requête reçoit un 401 : l'utilisateur doit se reconnecter.
 */
export async function requireMail(event: H3Event): Promise<MailSession> {
  const { user, secure } = await requireUserSession(event)
  const creds = secure?.sid ? credentialsStore.get(secure.sid) : null

  if (!user?.email || !secure?.sid || !creds || creds.email !== user.email) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Session expirée', message: 'Session expirée' })
  }

  const { kind, server } = mailConfig(event)
  const backend = await backendPool.getOrCreate(secure.sid, kind, creds, server)
  return { email: user.email, sid: secure.sid, backend }
}

/**
 * Convertit une erreur en réponse HTTP sans fuite d'informations internes.
 * Les erreurs HTTP déjà formées (401, 400 de validation, 429…) sont conservées.
 */
export function mailError(err: unknown): H3Error {
  if (isError(err)) return err
  if (err instanceof MailError) {
    const map = {
      NOT_FOUND: [404, 'Élément introuvable'],
      INVALID: [400, 'Requête invalide'],
      AUTH_FAILED: [401, 'Authentification refusée par le serveur de messagerie'],
      UNAVAILABLE: [503, 'Serveur de messagerie indisponible'],
    } as const
    const [statusCode, message] = map[err.code]
    return createError({ statusCode, statusMessage: message, message })
  }
  console.error('[webmail] erreur inattendue', err instanceof Error ? err.name : typeof err)
  return createError({ statusCode: 500, statusMessage: 'Erreur serveur', message: 'Erreur serveur' })
}
