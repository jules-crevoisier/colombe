import { credentialsStore } from '../../lib/session/credentials'
import { listUserFolders } from '../../lib/mail/user-folders'
import { backendPool } from '../../lib/session/pool'
import { getPrefs } from '../../lib/store/prefs'
import { useDb } from '../../lib/store/db'
import { mailConfig } from '../../utils/mail-session'
// clearUserSession, getUserSession are auto-imported by nuxt-auth-utils

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)

  if (session?.secure?.sid && session.user?.email) {
    const sid = session.secure.sid
    const email = session.user.email

    // Préférences de déconnexion (R2.8) : une erreur ici ne doit jamais empêcher la déconnexion.
    try {
      const prefs = getPrefs(useDb(), email)
      if (prefs.logoutEmptyTrash || prefs.logoutExpunge) {
        const creds = credentialsStore.get(sid)
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
  }

  await clearUserSession(event)

  setResponseStatus(event, 204)
  return null
})
