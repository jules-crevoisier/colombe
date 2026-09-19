import type { Folder } from '#shared/types/mail'
import { i18n } from '~/lib/i18n'

/**
 * Nom affiché d'un dossier : les dossiers spéciaux (réception, envoyés, brouillons,
 * corbeille, spam, archives) sont traduits d'après `specialUse`, jamais d'après le
 * libellé renvoyé par le serveur ; les dossiers personnels gardent leur nom.
 */
export function folderLabel(folder: Pick<Folder, 'name' | 'specialUse'>): string {
  return folder.specialUse ? i18n.global.t(`folders.special.${folder.specialUse}`) : folder.name
}
