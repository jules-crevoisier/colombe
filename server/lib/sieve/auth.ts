/**
 * Authentification ManageSieve d'une session et fenêtre de réauthentification SSO.
 * Fonctions pures (sans h3), testées dans tests/unit/mail/sasl.test.ts et
 * tests/unit/auth/oidc.test.ts ; utilisées par service.ts.
 */
import type { MailSsoConfig } from '../config'
import type { MailCredentials } from '../mail/backend'
import { mailUsername } from '../mail/backend'
import { SieveError } from './client'
import type { SieveCredentials } from './client'

/** Fenêtre de validité d'une réauthentification chez le fournisseur d'identité. */
export const SSO_REAUTH_WINDOW_MS = 5 * 60_000

/** Réauthentification OIDC récente (GET /api/auth/oidc/start?reauth=1) pour cette session. */
export function hasRecentSsoReauth(reauthAt: number | undefined, now: number): boolean {
  return typeof reauthAt === 'number' && reauthAt <= now && now - reauthAt < SSO_REAUTH_WINDOW_MS
}

/** Authentification ManageSieve d'une session (mot de passe, jeton OIDC ou utilisateur maître). */
export function sieveCredentials(
  creds: MailCredentials,
  cfg: { loginUsername: 'email' | 'localpart'; mailSso: MailSsoConfig | null }
): SieveCredentials {
  const user = mailUsername(creds.email, { loginUsername: cfg.loginUsername })
  const auth = creds.auth
  if (auth.kind === 'password') return { kind: 'plain', user, password: auth.password }
  if (auth.kind === 'oauth2') {
    const mechanism = cfg.mailSso?.mode === 'oauth2' ? cfg.mailSso.mechanism : 'xoauth2'
    return { kind: mechanism, user, accessToken: auth.accessToken }
  }
  if (cfg.mailSso?.mode !== 'master') throw new SieveError('AUTH_FAILED', 'Session sans configuration MAIL_SSO_AUTH=master')
  // SASL PLAIN : authzid = l'utilisateur, authcid = l'utilisateur maître (RFC 4616).
  return { kind: 'plain', user: cfg.mailSso.masterUser, password: cfg.mailSso.masterPassword, authzid: user }
}
