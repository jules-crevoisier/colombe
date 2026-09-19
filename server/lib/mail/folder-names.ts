import { z } from 'zod'
import type { Folder, SpecialFolders, SpecialUse } from '#shared/types/mail'

const OVERRIDABLE_USES: Array<Exclude<SpecialUse, 'inbox'>> = ['sent', 'drafts', 'trash', 'junk', 'archive']

/** Nom de dossier saisi par l'utilisateur (un seul niveau : pas de délimiteur). */
export const folderNameSchema = z.string().trim().min(1, 'Nom requis').max(100, '100 caractères au maximum')
  .refine(n => !/[\r\n\\/%*"]/.test(n), 'Caractères non autorisés : / \\ % * "')

/**
 * Préfixe sous lequel créer un dossier racine : celui des dossiers spéciaux
 * existants (« INBOX. » sur un Dovecot à espace de noms INBOX, vide sinon).
 */
export function rootPrefix(folders: Folder[]): string {
  const sample = folders.find(f => f.specialUse && f.specialUse !== 'inbox')
  if (!sample) return ''
  const idx = sample.path.lastIndexOf(sample.delimiter)
  return idx > 0 ? sample.path.slice(0, idx + sample.delimiter.length) : ''
}

export function delimiterOf(folders: Folder[]): string {
  return folders.find(f => f.delimiter)?.delimiter ?? '.'
}

/**
 * Applique `prefs.specialFolders` (R2.4/R2.8) : quand un chemin est configuré
 * (non vide) pour un usage donné, ce chemin devient l'unique dossier de cet
 * usage, quoi que le serveur ait détecté. Les usages vides gardent la
 * détection automatique du serveur.
 */
export function applySpecialFolderOverrides(folders: Folder[], overrides: SpecialFolders): Folder[] {
  const active = OVERRIDABLE_USES.filter(use => overrides[use].trim())
  if (!active.length) return folders

  return folders.map((folder) => {
    for (const use of active) {
      if (folder.path === overrides[use]) return { ...folder, specialUse: use }
    }
    // Un dossier détecté par le serveur pour un usage désormais réassigné
    // ailleurs par les préférences perd ce statut spécial.
    if (folder.specialUse && folder.specialUse !== 'inbox' && active.includes(folder.specialUse)) {
      return { ...folder, specialUse: null }
    }
    return folder
  })
}
