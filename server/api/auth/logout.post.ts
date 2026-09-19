import { credentialsStore } from '../../lib/session/credentials'
import { listUserFolders } from '../../lib/mail/user-folders'
import { backendPool } from '../../lib/session/pool'
import { sievePool } from '../../lib/session/sieve-pool'
import { getPrefs } from '../../lib/store/prefs'
import { useDb } from '../../lib/store/db'
import { getConfig } from '../../lib/config'
import { endSessionUrl, getOidcConfiguration } from '../../lib/auth/oidc/client'
import { freshCredentials } from '../../lib/auth/oidc/session'
import { appPageUrl } from '../../lib/auth/oidc/urls'
import { mailConfig } from '../../utils/mail-session'
import { appBase, requestOrigin } from '../../utils/oidc-route'
// clearUserSession, getUserSession are auto-imported by nuxt-auth-utils

/**
 * Où envoyer le navigateur après la déconnexion :
 *   1. session OIDC + OIDC_LOGOUT : déconnexion chez le fournisseur (end_session_endpoint,
 *      id_token_hint, retour sur la page de connexion) ;
 *   2. sinon COLOMBE_PORTAL_URL (« Retour à l'ENT ») ;
 *   3. sinon rien (page de connexion de Colombe).
 */
async function logoutRedirect(event: Parameters<typeof appBase>[0], oidcSession: boolean, idToken: string | undefined): Promise<string | null> {
  const config = getConfig()
  if (oidcSession && config.oidc?.logout) {
    try {
      const cfg = await getOidcConfiguration(config.oidc)
      const loginPage = appPageUrl(requestOrigin(event, config.trustProxy), appBase(event), 'login')
      const url = endSessionUrl(cfg, idToken, loginPage)
      if (url) return url
    }
    catch (err) {
      // Fournisseur injoignable : la déconnexion locale suffit, jamais bloquante.
      console.error('[colombe] OIDC : déconnexion chez le fournisseur impossible', err instanceof Error ? err.message : typeof err)
    }
  }
  return config.portalUrl
}

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const oidcSession = session?.authMethod === 'oidc'
  let idToken: string | undefined

  if (session?.secure?.sid && session.user?.email) {
    const sid = session.secure.sid
    const email = session.user.email
    idToken = credentialsStore.getSso(sid)?.idToken

    // Préférences de déconnexion (R2.8) : une erreur ici ne doit jamais empêcher la déconnexion.
    try {
      const prefs = getPrefs(useDb(), email)
      if (prefs.logoutEmptyTrash || prefs.logoutExpunge) {
        const creds = await freshCredentials(sid)
        if (creds) {
          const { kind, server } = mailConfig(event)
          const backend = await backendPool.getOrCreate(sid, kind, creds, server)

          if (prefs.logoutEmptyTrash) {
            const trash = (await listUserFolders(backend, email)).find(f => f.specialUse === 'trash')
            if (trash) {
              const uids = await backend.allUids(trash.path)
              if (uids.length > 0) await backend.expunge(trash.path, uids)
            }
          }

          // logoutExpunge (« compacter la boîte de réception à la déconnexion ») demande
          // de ne libérer QUE les messages déjà marqués \Deleted côté serveur — un vrai
          // EXPUNGE IMAP sans cible précise. `MailBackend.expunge(folder, uids)` marque
          // \Deleted PUIS purge exactement les UID donnés : lui passer `allUids(INBOX)`
          // effacerait TOUTE la boîte de réception, pas seulement ce qui est déjà
          // marqué supprimé. Aucune méthode de l'interface n'expose « purger les
          // messages déjà \Deleted » sans cibler des UID précis (ni ImapBackend ni
          // MockBackend, tous deux hors périmètre de cette tâche). Ne rien faire est
          // donc plus sûr qu'une opération destructrice non voulue : `logoutExpunge`
          // est un no-op documenté ici jusqu'à l'ajout d'une méthode dédiée
          // (ex. `expungeFlagged(folder)`) sur `MailBackend`.
        }
      }
    }
    catch {
      // Idem : jamais bloquer la déconnexion.
    }

    credentialsStore.delete(sid)
    await backendPool.delete(sid)
    await sievePool.delete(sid)
  }

  await clearUserSession(event)

  // Rien à suivre : 204 comme avant. Sinon { redirect } (fournisseur d'identité ou portail),
  // que le client suit après avoir vidé ses caches.
  const redirect = await logoutRedirect(event, oidcSession, idToken)
  if (!redirect) {
    setResponseStatus(event, 204)
    return null
  }
  return { redirect }
})
