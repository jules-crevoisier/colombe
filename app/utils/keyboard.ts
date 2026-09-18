/** Vrai si l'utilisateur est en train de saisir (les raccourcis clavier sont alors ignorés). */
export function isTypingTarget(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true
  const el = e.target instanceof Element ? e.target : null
  return !!el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
}

/** Type MIME du glisser-déposer de messages entre la liste et les dossiers. */
export const DRAG_MIME = 'application/x-webmail-messages'

export interface DragPayload {
  folder: string
  uids: number[]
}

export function parseDragPayload(raw: string): DragPayload | null {
  try {
    const data = JSON.parse(raw) as Partial<DragPayload>
    if (typeof data.folder !== 'string' || !Array.isArray(data.uids)) return null
    const uids = data.uids.filter((n): n is number => Number.isInteger(n) && n > 0)
    return uids.length ? { folder: data.folder, uids } : null
  }
  catch {
    return null
  }
}

export const SHORTCUTS: Array<{ keys: string; label: string; scope: 'Partout' | 'Liste' | 'Message' }> = [
  { keys: 'c', label: 'Nouveau message', scope: 'Partout' },
  { keys: '/', label: 'Rechercher', scope: 'Partout' },
  { keys: '?', label: 'Afficher les raccourcis', scope: 'Partout' },
  { keys: 'j / k', label: 'Message suivant / précédent', scope: 'Liste' },
  { keys: 'Entrée', label: 'Ouvrir le message', scope: 'Liste' },
  { keys: 'x', label: 'Sélectionner', scope: 'Liste' },
  { keys: 's', label: 'Étoile', scope: 'Liste' },
  { keys: 'e', label: 'Archiver', scope: 'Liste' },
  { keys: '#', label: 'Supprimer', scope: 'Liste' },
  { keys: 'r', label: 'Répondre', scope: 'Message' },
  { keys: 'a', label: 'Répondre à tous', scope: 'Message' },
  { keys: 'f', label: 'Transférer', scope: 'Message' },
  { keys: 'e', label: 'Archiver', scope: 'Message' },
  { keys: '#', label: 'Supprimer', scope: 'Message' },
  { keys: 'u', label: 'Retour à la liste', scope: 'Message' },
  { keys: 'Ctrl + Entrée', label: 'Envoyer', scope: 'Partout' },
]
