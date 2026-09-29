/**
 * UIDs de la plage comprise (bornes incluses) entre `anchor` et `target` dans l'ordre
 * d'affichage de la liste, que l'on descende ou que l'on remonte. Vide si l'un des deux
 * n'est plus dans la liste (page changée, message supprimé) : l'appelant retombe alors sur
 * une bascule simple.
 */
export function rangeUids(uids: readonly number[], anchor: number | null, target: number): number[] {
  if (anchor === null) return []
  const from = uids.indexOf(anchor)
  const to = uids.indexOf(target)
  if (from === -1 || to === -1) return []
  return uids.slice(Math.min(from, to), Math.max(from, to) + 1)
}
