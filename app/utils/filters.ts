import type { FilterAction, FilterCondition, FilterField, FilterOp, FilterRule } from '#shared/types/mail'
import { i18n } from '~/lib/i18n'

/** Clés de traduction des champs (docs/dev/PLAN-v4.md section F « Interface »). */
export const FIELD_LABELS: Record<FilterField, string> = {
  'from': 'filters.fields.from',
  'to-cc': 'filters.fields.toCc',
  'subject': 'filters.fields.subject',
  'size': 'filters.fields.size',
  'header': 'filters.fields.header',
  'body': 'filters.fields.body',
  'date': 'filters.fields.date',
  'spam': 'filters.fields.spam',
}

export const OP_LABELS: Record<FilterOp, string> = {
  'contains': 'filters.ops.contains',
  'not-contains': 'filters.ops.notContains',
  'is': 'filters.ops.is',
  'is-not': 'filters.ops.isNot',
  'starts-with': 'filters.ops.startsWith',
  'matches': 'filters.ops.matches',
  'over': 'filters.ops.over',
  'under': 'filters.ops.under',
  'count-over': 'filters.ops.countOver',
  'value-over': 'filters.ops.valueOver',
  'before': 'filters.ops.before',
  'after': 'filters.ops.after',
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
  const { t } = i18n.global
  const label = c.field === 'header' ? (c.header?.trim() || t('filters.fields.headerFallback')) : t(FIELD_LABELS[c.field])
  if (c.op === 'contains' && (c.field === 'from' || c.field === 'to-cc' || c.field === 'subject')) {
    return t('filters.describe.conditionShort', { label, value: c.value })
  }
  return t('filters.describe.conditionFull', { label, op: t(OP_LABELS[c.op]), value: c.value })
}

function describeAction(a: FilterAction, folderName: (path: string) => string): string {
  const { t } = i18n.global
  switch (a.type) {
    case 'move': return t('filters.describe.action.move', { folder: folderName(a.folder) })
    case 'copy': return t('filters.describe.action.copy', { folder: folderName(a.folder) })
    case 'mark-read': return t('filters.describe.action.markRead')
    case 'flag': return t('filters.describe.action.flag')
    case 'add-flag': return t('filters.describe.action.addFlag', { flag: a.flag })
    case 'delete': return t('filters.describe.action.delete')
    case 'stop': return t('filters.describe.action.stop')
    case 'redirect': return t('filters.describe.action.redirect', { address: a.address })
    case 'reject': return t('filters.describe.action.reject')
    case 'add-header': return t('filters.describe.action.addHeader', { name: a.name })
    case 'notify': return t('filters.describe.action.notify', { address: a.address })
    default: return ''
  }
}

/** Ligne lisible d'un filtre, ex. « De : scolarite@universite.example → Classer dans Projets, Marquer comme lu ». */
export function describeRule(rule: FilterRule, folderName: (path: string) => string): string {
  const { t } = i18n.global
  const conditions = rule.conditions.length
    ? rule.conditions.map(describeCondition).join(rule.match === 'any' ? t('filters.describe.anySeparator') : ', ')
    : t('filters.common.allMessages')
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
