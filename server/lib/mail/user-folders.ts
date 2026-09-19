import type { Folder } from '#shared/types/mail'
import type { MailBackend } from './backend'
import { applySpecialFolderOverrides } from './folder-names'
import { getPrefs } from '../store/prefs'
import { useDb } from '../store/db'

/**
 * Dossiers de l'utilisateur avec ses choix de dossiers spéciaux (`prefs.specialFolders`).
 * À utiliser partout où l'on cherche Envoyés, Brouillons, Corbeille, Spam ou Archives,
 * pour que l'envoi, la suppression et le spam suivent les mêmes réglages que la liste.
 */
export async function listUserFolders(backend: MailBackend, owner: string, opts: { all?: boolean } = {}): Promise<Folder[]> {
  const folders = await backend.listFolders(opts)
  return applySpecialFolderOverrides(folders, getPrefs(useDb(), owner).specialFolders)
}
