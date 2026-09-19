/**
 * FilterRule[] + VacationSettings + ForwardSettings -> script Sieve.
 * Le JSON des règles est gardé en commentaire d'en-tête (parse-json.ts) pour
 * pouvoir régénérer l'interface d'édition sans reparser le Sieve produit.
 *
 * N'émet que les fonctions annoncées par les capacités du serveur ; sinon
 * lève SieveGenerateError (400 côté route).
 */
import type { FilterAction, FilterCondition, FilterRule, ForwardSettings, VacationSettings } from '#shared/types/mail'
import { writeManagedHeader } from './parse-json'
import type { LocalizedMessage, ServerMessageKey } from '../i18n'
import { frenchText } from '../i18n'

/** Message d'origine en français ; `i18n` le traduit dans la langue de la requête (sieveError). */
export class SieveGenerateError extends Error {
  readonly i18n: LocalizedMessage | undefined
  constructor(message: string | LocalizedMessage) {
    super(typeof message === 'string' ? message : frenchText(message))
    this.name = 'SieveGenerateError'
    this.i18n = typeof message === 'string' ? undefined : message
  }
}

/** Fonctionnalité Sieve exigée par une règle (nom affiché : sieve.feature.*). */
type SieveFeature = 'body' | 'date' | 'spam' | 'fileinto' | 'copyTo' | 'markRead' | 'flag' | 'addFlag' | 'forwardKeepCopy' | 'reject' | 'addHeader' | 'notify' | 'vacation' | 'vacationDates' | 'incomingCopy'

function featureKey(feature: SieveFeature): ServerMessageKey {
  return `sieve.feature.${feature}`
}

export interface GenerateInput {
  rules: FilterRule[]
  vacation: VacationSettings | null
  forward: ForwardSettings | null
  /** Capacités Sieve annoncées par le serveur (ex. fileinto, vacation, copy…). */
  capabilities: string[]
}

/** Domaine autorisé pour un transfert/redirection/notification (comparaison insensible à la casse, sous-domaine non inclus). */
export function isAllowedForwardTarget(address: string, forwardDomains: string[]): boolean {
  const at = address.lastIndexOf('@')
  if (at < 0 || at === address.length - 1) return false
  const domain = address.slice(at + 1).toLowerCase().replace(/\.$/, '')
  return forwardDomains.some((d) => domain === d.trim().toLowerCase())
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function quoteList(values: string[]): string {
  return `[${values.map(quote).join(', ')}]`
}

/** Chaîne Sieve : littéral `text:` avec délimitage par point pour les textes longs ou multi-lignes. */
function sieveText(value: string): string {
  if (!value.includes('\n') && !value.includes('\r') && value.length <= 128) {
    return quote(value)
  }
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const stuffed = lines.map((l) => (l.startsWith('.') ? `.${l}` : l))
  return `text:\r\n${stuffed.join('\r\n')}\r\n.\r\n`
}

class Emitter {
  private used = new Set<string>()

  constructor(private readonly capabilities: string[]) {}

  require(name: string, feature: SieveFeature): void {
    if (!this.capabilities.includes(name)) {
      throw new SieveGenerateError({ key: 'sieve.unsupportedFeature', params: { feature: { key: featureKey(feature) } } })
    }
    this.used.add(name)
  }

  requireList(): string[] {
    return [...this.used].sort()
  }
}

function comparatorSuffix(condition: FilterCondition): string {
  return condition.caseSensitive ? ' :comparator "i;octet"' : ' :comparator "i;ascii-casemap"'
}

function matchTest(op: FilterOpLike, valueArg: string, negate: () => void): { flag: string; value: string } {
  switch (op) {
    case 'contains': return { flag: ':contains', value: valueArg }
    case 'not-contains': negate(); return { flag: ':contains', value: valueArg }
    case 'is': return { flag: ':is', value: valueArg }
    case 'is-not': negate(); return { flag: ':is', value: valueArg }
    case 'starts-with': return { flag: ':matches', value: `${valueArg}*` }
    case 'matches': return { flag: ':matches', value: valueArg }
    default: return { flag: ':contains', value: valueArg }
  }
}

type FilterOpLike = FilterCondition['op']

/** Génère le test Sieve pour une condition ; `wrap` reçoit le corps et l'englobe de `not (...)` si besoin. */
function buildCondition(condition: FilterCondition, e: Emitter): string {
  let negated = false
  const negate = () => { negated = true }

  let body: string
  switch (condition.field) {
    case 'from': {
      const part = condition.addressPart ?? 'all'
      const { flag, value } = matchTest(condition.op, quote(condition.value), negate)
      body = `address :${part} ${flag}${comparatorSuffix(condition)} ["from"] ${value}`
      break
    }
    case 'to-cc': {
      const part = condition.addressPart ?? 'all'
      const { flag, value } = matchTest(condition.op, quote(condition.value), negate)
      body = `address :${part} ${flag}${comparatorSuffix(condition)} ["to", "cc"] ${value}`
      break
    }
    case 'subject': {
      const { flag, value } = matchTest(condition.op, quote(condition.value), negate)
      body = `header ${flag}${comparatorSuffix(condition)} ["subject"] ${value}`
      break
    }
    case 'header': {
      const headerName = condition.header?.trim() || 'x-header'
      const { flag, value } = matchTest(condition.op, quote(condition.value), negate)
      body = `header ${flag}${comparatorSuffix(condition)} ${quoteList([headerName])} ${value}`
      break
    }
    case 'body': {
      e.require('body', 'body')
      const { flag, value } = matchTest(condition.op, quote(condition.value), negate)
      body = `body ${flag}${comparatorSuffix(condition)} ${value}`
      break
    }
    case 'size': {
      const kb = Number(condition.value)
      if (!Number.isFinite(kb) || kb < 0) throw new SieveGenerateError({ key: 'sieve.invalidSize' })
      const flag = condition.op === 'under' ? ':under' : ':over'
      body = `size ${flag} ${Math.round(kb)}K`
      break
    }
    case 'date': {
      e.require('date', 'date')
      const cmp = condition.op === 'before' ? 'le' : 'ge'
      body = `date :value "${cmp}" "date" ${quote(condition.value)}`
      break
    }
    case 'spam': {
      e.require('spamtest', 'spam')
      e.require('relational', 'spam')
      body = `spamtest :value "ge" :comparator "i;ascii-numeric" ${quote(condition.value)}`
      break
    }
    default:
      throw new SieveGenerateError(`Champ de condition non pris en charge : ${condition.field satisfies never}`)
  }

  return negated ? `not (${body})` : body
}

function buildTest(rule: FilterRule, e: Emitter): string {
  if (rule.conditions.length === 0) return 'true'
  if (rule.conditions.length === 1) return buildCondition(rule.conditions[0] as FilterCondition, e)
  const parts = rule.conditions.map((c) => buildCondition(c, e))
  const combinator = rule.match === 'any' ? 'anyof' : 'allof'
  return `${combinator}(${parts.join(', ')})`
}

function buildActions(actions: FilterAction[], e: Emitter, forwardDomains: string[]): string[] {
  const lines: string[] = []
  for (const action of actions) {
    switch (action.type) {
      case 'move':
        e.require('fileinto', 'fileinto')
        lines.push(`fileinto ${quote(action.folder)};`)
        break
      case 'copy':
        e.require('fileinto', 'copyTo')
        e.require('copy', 'copyTo')
        lines.push(`fileinto :copy ${quote(action.folder)};`)
        break
      case 'mark-read':
        e.require('imap4flags', 'markRead')
        lines.push('addflag "\\\\Seen";')
        break
      case 'flag':
        e.require('imap4flags', 'flag')
        lines.push('addflag "\\\\Flagged";')
        break
      case 'add-flag':
        e.require('imap4flags', 'addFlag')
        lines.push(`addflag ${quote(action.flag)};`)
        break
      case 'delete':
        lines.push('discard;')
        break
      case 'stop':
        lines.push('stop;')
        break
      case 'redirect': {
        if (!isAllowedForwardTarget(action.address, forwardDomains)) {
          throw new SieveGenerateError({ key: 'sieve.forwardDomainRefused' })
        }
        if (action.keepCopy) e.require('copy', 'forwardKeepCopy')
        lines.push(action.keepCopy ? `redirect :copy ${quote(action.address)};` : `redirect ${quote(action.address)};`)
        break
      }
      case 'reject':
        e.require('reject', 'reject')
        lines.push(`reject ${quote(action.message.slice(0, 500))};`)
        break
      case 'add-header':
        e.require('editheader', 'addHeader')
        lines.push(`addheader ${quote(action.name)} ${quote(action.value)};`)
        break
      case 'notify': {
        if (!isAllowedForwardTarget(action.address, forwardDomains)) {
          throw new SieveGenerateError({ key: 'sieve.forwardDomainRefused' })
        }
        e.require('enotify', 'notify')
        lines.push(`notify :message ${quote(action.message)} ${quote(`mailto:${action.address}`)};`)
        break
      }
      default:
        throw new SieveGenerateError({ key: 'sieve.unsupportedAction' })
    }
  }
  return lines
}

function buildRule(rule: FilterRule, e: Emitter, forwardDomains: string[]): string {
  const test = buildTest(rule, e)
  const actionLines = buildActions(rule.actions, e, forwardDomains).map((l) => `    ${l}`)
  return `# rule:${rule.name.replace(/[\r\n]/g, ' ')}\nif ${test} {\n${actionLines.join('\n')}\n}`
}

function buildVacationBlock(vacation: VacationSettings, e: Emitter, forwardDomains: string[]): string {
  e.require('vacation', 'vacation')

  const dateTests: string[] = []
  if (vacation.from) {
    e.require('date', 'vacationDates')
    dateTests.push(`currentdate :value "ge" "date" ${quote(vacation.from)}`)
  }
  if (vacation.until) {
    e.require('date', 'vacationDates')
    dateTests.push(`currentdate :value "le" "date" ${quote(vacation.until)}`)
  }
  const test = dateTests.length === 0 ? 'true' : dateTests.length === 1 ? dateTests[0] : `allof(${dateTests.join(', ')})`

  const body: string[] = []
  const addresses = quoteList([vacation.replyFrom, ...vacation.addresses])
  body.push(
    `    vacation :days ${vacation.days} :subject ${quote(vacation.subject)} :addresses ${addresses} :from ${quote(vacation.replyFrom)} ${sieveText(vacation.message)};`
  )

  if (vacation.incoming === 'discard') {
    body.push('    discard;')
  } else if (vacation.incoming === 'redirect' || vacation.incoming === 'copy') {
    if (!vacation.incomingAddress || !isAllowedForwardTarget(vacation.incomingAddress, forwardDomains)) {
      throw new SieveGenerateError({ key: 'sieve.forwardDomainRefused' })
    }
    if (vacation.incoming === 'copy') e.require('copy', 'incomingCopy')
    body.push(vacation.incoming === 'copy'
      ? `    redirect :copy ${quote(vacation.incomingAddress)};`
      : `    redirect ${quote(vacation.incomingAddress)};`)
  }
  // 'keep' : rien à ajouter, le comportement par défaut de Sieve est de garder le message.

  return `# rule:colombe-vacation\nif ${test} {\n${body.join('\n')}\n}`
}

function buildForwardBlock(forward: ForwardSettings, e: Emitter, forwardDomains: string[]): string {
  if (!isAllowedForwardTarget(forward.address, forwardDomains)) {
    throw new SieveGenerateError({ key: 'sieve.forwardDomainRefused' })
  }
  if (forward.keepCopy) e.require('copy', 'forwardKeepCopy')
  const action = forward.keepCopy ? `redirect :copy ${quote(forward.address)};` : `redirect ${quote(forward.address)};`
  return `# rule:colombe-transfert\nif true {\n    ${action}\n}`
}

/**
 * Domaines autorisés passés séparément (pas dans GenerateInput) car ils
 * viennent de la config serveur (MAIL_FORWARD_DOMAINS), pas des capacités.
 */
export function generateScript(input: GenerateInput, forwardDomains: string[]): string {
  const e = new Emitter(input.capabilities)
  const blocks: string[] = []

  for (const rule of input.rules) {
    if (!rule.enabled) continue
    blocks.push(buildRule(rule, e, forwardDomains))
  }

  if (input.vacation?.enabled) {
    blocks.push(buildVacationBlock(input.vacation, e, forwardDomains))
  }

  if (input.forward?.enabled) {
    blocks.push(buildForwardBlock(input.forward, e, forwardDomains))
  }

  const requireLine = e.requireList().length > 0 ? `require ${quoteList(e.requireList())};\n\n` : ''
  const header = writeManagedHeader({ rules: input.rules, vacation: input.vacation, forward: input.forward })

  return `${header}\n${requireLine}${blocks.join('\n\n')}\n`
}
