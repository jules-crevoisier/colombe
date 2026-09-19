import type { FilterAction, FilterCondition, FilterField, FilterOp, FilterRule } from '#shared/types/mail'

/** Libellés contractuels (docs/dev/PLAN-v4.md section F « Interface »). */
export const FIELD_LABELS: Record<FilterField, string> = {
  'from': 'De',
  'to-cc': 'À ou Cc',
  'subject': 'Objet',
  'size': 'Taille',
  'header': 'En-tête…',
  'body': 'Corps du message',
  'date': 'Date de réception',
  'spam': 'Niveau de spam',
}

export const OP_LABELS: Record<FilterOp, string> = {
  'contains': 'contient',
  'not-contains': 'ne contient pas',
  'is': 'est',
  'is-not': "n'est pas",
  'starts-with': 'commence par',
  'matches': 'correspond à',
  'over': 'plus grand que',
  'under': 'plus petit que',
  'count-over': 'plus de',
  'value-over': 'valeur supérieure à',
  'before': 'avant le',
  'after': 'après le',
}

/** Opérateurs proposés selon le champ (docs/dev/PLAN-v4.md section F « Interface »). */
export const OPS_BY_FIELD: Record<FilterField, FilterOp[]> = {
  'from': ['contains', 'not-contains', 'is', 'is-not', 'starts-with', 'matches'],
  'to-cc': ['contains', 'not-contains', 'is', 'is-not', 'starts-with', 'matches'],
  'subject': ['contains', 'not-contains', 'is', 'is-not', 'starts-with', 'matches'],
  'header': ['contains', 'not-contains', 'is', 'is-not', 'starts-with', 'matches'],
  'body': ['contains', 'not-contains', 'is', 'is-not', 'starts-with', 'matches'],
  'size': ['over', 'under'],
  'date': ['before', 'after'],
  'spam': ['over'],
}

function describeCondition(c: FilterCondition): string {
  const label = c.field === 'header' ? (c.header?.trim() || 'En-tête') : FIELD_LABELS[c.field]
  if (c.op === 'contains' && (c.field === 'from' || c.field === 'to-cc' || c.field === 'subject')) {
    return `${label} : ${c.value}`
  }
  return `${label} ${OP_LABELS[c.op]} ${c.value}`
}

function describeAction(a: FilterAction, folderName: (path: string) => string): string {
  switch (a.type) {
    case 'move': return `Classer dans ${folderName(a.folder)}`
    case 'copy': return `Copier vers ${folderName(a.folder)}`
    case 'mark-read': return 'Marquer comme lu'
    case 'flag': return 'Suivre'
    case 'add-flag': return `Ajouter le mot-clé « ${a.flag} »`
    case 'delete': return 'Supprimer'
    case 'stop': return 'Arrêter les filtres suivants'
    case 'redirect': return `Rediriger vers ${a.address}`
    case 'reject': return 'Rejeter avec un message'
    case 'add-header': return `Ajouter l'en-tête ${a.name}`
    case 'notify': return `M'avertir à ${a.address}`
    default: return ''
  }
}

/** Ligne lisible d'un filtre, ex. « De : scolarite@universite.example → Classer dans Projets, Marquer comme lu ». */
export function describeRule(rule: FilterRule, folderName: (path: string) => string): string {
  const conditions = rule.conditions.length
    ? rule.conditions.map(describeCondition).join(rule.match === 'any' ? ' ou ' : ', ')
    : 'Tous les messages'
  const actions = rule.actions.map(a => describeAction(a, folderName)).join(', ')
  return `${conditions} → ${actions}`
}

/** Capacités Sieve requises par une action de filtre (server/lib/sieve/generate.ts). */
export function actionCapabilities(type: FilterAction['type']): string[] {
  switch (type) {
    case 'move': return ['fileinto']
    case 'copy': return ['fileinto', 'copy']
    case 'mark-read':
    case 'flag':
    case 'add-flag': return ['imap4flags']
    case 'reject': return ['reject']
    case 'add-header': return ['editheader']
    case 'notify': return ['enotify']
    default: return []
  }
}

/** Capacités Sieve requises par un champ de condition (server/lib/sieve/generate.ts). */
export function fieldCapabilities(field: FilterField): string[] {
  switch (field) {
    case 'body': return ['body']
    case 'date': return ['date']
    case 'spam': return ['relational', 'spamtest']
    default: return []
  }
}

export function isSupported(capabilities: string[], required: string[]): boolean {
  return required.every(c => capabilities.includes(c))
}

let idCounter = 0
/** Identifiant local pour une nouvelle règle (le serveur ne renumérote pas). */
export function newFilterId(): string {
  idCounter += 1
  return `f${Date.now().toString(36)}${idCounter}`
}

export function emptyRule(): FilterRule {
  return { id: newFilterId(), name: '', enabled: true, match: 'all', conditions: [], actions: [] }
}
