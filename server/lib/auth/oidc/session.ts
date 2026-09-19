/**
 * Identifiants mail d'une session, jeton OIDC rafraîchi si nécessaire (voir refresh.ts).
 * Point d'entrée unique avant tout accès IMAP/SMTP/ManageSieve : requireMail,
 * openSieveSession, alerte de transfert.
 */
import { getConfig } from '../../config'
import type { MailCredentials } from '../../mail/backend'
import { credentialsStore } from '../../session/credentials'
import { backendPool } from '../../session/pool'
import { sievePool } from '../../session/sieve-pool'
import { getOidcConfiguration, refreshTokens } from './client'
import { TokenRefresher } from './refresh'

export const oidcRefresher = new TokenRefresher({
  refresh: async (refreshToken) => {
    const oidc = getConfig().oidc
    if (!oidc) throw new Error('OIDC désactivé')
    return refreshTokens(await getOidcConfiguration(oidc), refreshToken)
  },
})

/**
 * Identifiants de la session `sid`, ou null si elle n'existe plus — y compris quand le
 * jeton d'accès a expiré sans pouvoir être renouvelé : la session est alors détruite
 * (connexions fermées) et l'appelant répond 401 (l'utilisateur se reconnecte).
 */
export async function freshCredentials(sid: string): Promise<MailCredentials | null> {
  const creds = credentialsStore.get(sid)
  if (!creds || creds.auth.kind !== 'oauth2') return creds
  const outcome = await oidcRefresher.ensureFresh(sid, creds.auth, tokens => credentialsStore.updateOAuth(sid, tokens))
  if (outcome !== 'expired') return creds
  credentialsStore.delete(sid)
  await backendPool.delete(sid)
  await sievePool.delete(sid)
  return null
}
