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

/**
 * `keys` est le libellé littéral d'une touche/combinaison sans mot français (symboles,
 * lettres) ; `keysKey` est utilisé à la place quand ce libellé doit être traduit (ex.
 * « Entrée »). `labelKey` et `scope` désignent des clés de `mail.shortcuts.*`, résolues
 * à l'affichage (jamais figées ici : elles doivent suivre un changement de langue).
 */
export interface Shortcut {
  keys: string
  keysKey?: string
  labelKey: string
  scope: 'everywhere' | 'list' | 'message'
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'c', labelKey: 'mail.shortcuts.items.compose', scope: 'everywhere' },
  { keys: '/', labelKey: 'mail.shortcuts.items.search', scope: 'everywhere' },
  { keys: '?', labelKey: 'mail.shortcuts.items.showShortcuts', scope: 'everywhere' },
  { keys: 'j / k', labelKey: 'mail.shortcuts.items.nextPrevious', scope: 'list' },
  { keys: '', keysKey: 'mail.shortcuts.keys.enter', labelKey: 'mail.shortcuts.items.openMessage', scope: 'list' },
  { keys: 'x', labelKey: 'mail.shortcuts.items.select', scope: 'list' },
  { keys: 's', labelKey: 'mail.shortcuts.items.star', scope: 'list' },
  { keys: 'e', labelKey: 'mail.shortcuts.items.archive', scope: 'list' },
  { keys: '#', labelKey: 'mail.shortcuts.items.delete', scope: 'list' },
  { keys: 'r', labelKey: 'mail.shortcuts.items.reply', scope: 'message' },
  { keys: 'a', labelKey: 'mail.shortcuts.items.replyAll', scope: 'message' },
  { keys: 'f', labelKey: 'mail.shortcuts.items.forward', scope: 'message' },
  { keys: 'e', labelKey: 'mail.shortcuts.items.archive', scope: 'message' },
  { keys: '#', labelKey: 'mail.shortcuts.items.delete', scope: 'message' },
  { keys: 'u', labelKey: 'mail.shortcuts.items.backToList', scope: 'message' },
  { keys: '', keysKey: 'mail.shortcuts.keys.ctrlEnter', labelKey: 'mail.shortcuts.items.send', scope: 'everywhere' },
]
