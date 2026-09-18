import { z } from 'zod'
import type { Folder } from '#shared/types/mail'

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
