/**
 * Lecture du fichier d'état du serveur mail (etat.json), écrit toutes les
 * 15 minutes par le script de surveillance `mail-sante`.
 *
 * Toute erreur (fichier absent, illisible, trop gros, JSON invalide, contrat
 * non respecté) donne null : la page affiche « état indisponible » sans jamais
 * exposer le détail de l'erreur ni le chemin du fichier.
 */
import { readFile, stat } from 'node:fs/promises'
import type { ServerStatus } from '#shared/types/server-status'
import { parseServerStatus } from './schema'

/** Le fichier réel pèse quelques dizaines de Ko ; au-delà de 2 Mo, il est refusé sans être lu. */
export const MAX_STATUS_BYTES = 2 * 1024 * 1024

export async function readServerStatus(file: string): Promise<ServerStatus | null> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_STATUS_BYTES) return null
    return parseServerStatus(JSON.parse(await readFile(file, 'utf8')))
  }
  catch {
    return null
  }
}
