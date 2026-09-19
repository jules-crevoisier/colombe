/**
 * Adresse de messagerie d'un utilisateur OIDC, lue dans une revendication (claim) du
 * jeton d'identité (OIDC_EMAIL_CLAIM). Fonction pure, testée seule.
 */
import type { ColombeConfig } from '../../config'
import { normalizeLoginEmail } from '../../config'

export type ClaimAddressResult =
  | { ok: true; email: string }
  /** missing : revendication absente ou vide ; unverified : email_verified=false ; domain : domaine refusé. */
  | { ok: false; reason: 'missing' | 'unverified' | 'domain'; value: string }

function claimValue(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  // Certains fournisseurs (CAS, attributs LDAP multivalués) renvoient un tableau.
  if (Array.isArray(raw)) {
    const first = raw.find((v): v is string => typeof v === 'string' && v.trim() !== '')
    return first?.trim() ?? ''
  }
  return ''
}

/**
 * Sans @ (identifiant seul : uid, sAMAccountName…), le domaine MAIL_LOGIN_DEFAULT_DOMAIN est
 * ajouté ; l'adresse obtenue doit ensuite passer les mêmes règles que la connexion par mot
 * de passe (`normalizeLoginEmail` : MAIL_DOMAINS). Une adresse explicitement NON vérifiée
 * (`email_verified: false`) est refusée : elle pourrait avoir été saisie par l'utilisateur.
 */
export function addressFromClaims(
  claims: Record<string, unknown>,
  claimName: string,
  config: Pick<ColombeConfig, 'login'>
): ClaimAddressResult {
  const value = claimValue(claims[claimName])
  if (!value) return { ok: false, reason: 'missing', value: '' }
  if (claimName === 'email' && claims.email_verified === false) return { ok: false, reason: 'unverified', value }
  const email = normalizeLoginEmail(value, config)
  if (!email) return { ok: false, reason: 'domain', value }
  return { ok: true, email }
}
