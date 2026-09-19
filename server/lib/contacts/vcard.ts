/**
 * vCard 3.0 minimal (RFC 2426) : assez pour importer/exporter le carnet
 * d'adresses (R2.3). Gère le dépliage des lignes, l'échappement des valeurs
 * et, en best-effort, l'encodage QUOTED-PRINTABLE (optionnel côté import).
 * Toujours en UTF-8.
 */
import type { ContactDetail, EmailLabel, PhoneLabel } from '#shared/types/mail'

export interface ParsedVCardContact {
  firstName: string
  lastName: string
  displayName: string
  emails: Array<{ label: EmailLabel; address: string }>
  phones: Array<{ label: PhoneLabel; number: string }>
  organization: string
  jobTitle: string
  birthday: string | null
}

interface VCardLine {
  name: string
  params: Record<string, string[]>
  value: string
}

/** Déplie les lignes (RFC 2425 §5.8.1) : une continuation commence par un espace ou une tabulation. */
function unfold(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rawLines = normalized.split('\n')
  const lines: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1)
    }
    else if (line.trim().length) {
      lines.push(line)
    }
  }
  return lines
}

function decodeQuotedPrintableUtf8(value: string): string {
  const cleaned = value.replace(/=(?:\r\n|\n|\r)/g, '')
  const bytes: number[] = []
  for (let i = 0; i < cleaned.length; i++) {
    const hex = cleaned.slice(i + 1, i + 3)
    if (cleaned[i] === '=' && /^[0-9a-fA-F]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      i += 2
    }
    else {
      bytes.push(cleaned.charCodeAt(i) & 0xFF)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function parseLine(line: string): VCardLine {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return { name: line.trim().toUpperCase(), params: {}, value: '' }

  const head = line.slice(0, colonIdx)
  const value = line.slice(colonIdx + 1)
  const parts = head.split(';')
  const rawName = parts[0] ?? ''
  const name = (rawName.includes('.') ? (rawName.split('.').pop() ?? rawName) : rawName).toUpperCase()

  const params: Record<string, string[]> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq === -1) {
      // Style vCard 2.1 : paramètre nu (ex. `;HOME;INTERNET`).
      params.TYPE = [...(params.TYPE ?? []), p.toUpperCase()]
      continue
    }
    const key = p.slice(0, eq).toUpperCase()
    const vals = p.slice(eq + 1).split(',').map(v => v.trim().toUpperCase())
    params[key] = [...(params[key] ?? []), ...vals]
  }
  return { name, params, value }
}

function unescapeValue(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

function decodeValue(raw: string, params: Record<string, string[]>): string {
  const value = params.ENCODING?.includes('QUOTED-PRINTABLE') ? decodeQuotedPrintableUtf8(raw) : raw
  return unescapeValue(value)
}

function emailLabelFromParams(params: Record<string, string[]>): EmailLabel {
  const types = params.TYPE ?? []
  if (types.includes('HOME')) return 'home'
  if (types.includes('WORK')) return 'work'
  return 'other'
}

function phoneLabelFromParams(params: Record<string, string[]>): PhoneLabel {
  const types = params.TYPE ?? []
  if (types.includes('CELL') || types.includes('MOBILE')) return 'mobile'
  if (types.includes('HOME')) return 'home'
  if (types.includes('WORK')) return 'work'
  return 'other'
}

interface CardBuilder {
  firstName: string
  lastName: string
  fn: string
  emails: Array<{ label: EmailLabel; address: string }>
  phones: Array<{ label: PhoneLabel; number: string }>
  organization: string
  jobTitle: string
  birthday: string | null
}

function emptyCard(): CardBuilder {
  return { firstName: '', lastName: '', fn: '', emails: [], phones: [], organization: '', jobTitle: '', birthday: null }
}

/** Analyse un fichier .vcf (une ou plusieurs cartes). */
export function parseVCards(content: string): ParsedVCardContact[] {
  const lines = unfold(content)
  const cards: ParsedVCardContact[] = []
  let current: CardBuilder | null = null

  for (const raw of lines) {
    const upper = raw.trim().toUpperCase()
    if (upper === 'BEGIN:VCARD') {
      current = emptyCard()
      continue
    }
    if (upper === 'END:VCARD') {
      if (current) {
        cards.push({
          firstName: current.firstName,
          lastName: current.lastName,
          displayName: current.fn,
          emails: current.emails,
          phones: current.phones,
          organization: current.organization,
          jobTitle: current.jobTitle,
          birthday: current.birthday,
        })
      }
      current = null
      continue
    }
    if (!current) continue

    const { name, params, value } = parseLine(raw)
    const decoded = decodeValue(value, params)

    switch (name) {
      case 'N': {
        const parts = decoded.split(';')
        current.lastName = (parts[0] ?? '').trim()
        current.firstName = (parts[1] ?? '').trim()
        break
      }
      case 'FN':
        current.fn = decoded.trim()
        break
      case 'EMAIL':
        if (decoded.trim()) current.emails.push({ label: emailLabelFromParams(params), address: decoded.trim().toLowerCase() })
        break
      case 'TEL':
        if (decoded.trim()) current.phones.push({ label: phoneLabelFromParams(params), number: decoded.trim() })
        break
      case 'ORG':
        current.organization = (decoded.split(';')[0] ?? '').trim()
        break
      case 'TITLE':
        current.jobTitle = decoded.trim()
        break
      case 'BDAY': {
        const m = decoded.trim().match(/^(\d{4})-?(\d{2})-?(\d{2})/)
        if (m) current.birthday = `${m[1]}-${m[2]}-${m[3]}`
        break
      }
      default:
        break
    }
  }

  return cards
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/** Replie une ligne à 75 octets (RFC 2426 §2.6), sans couper un caractère UTF-8 multi-octets. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const chunks: string[] = []
  let offset = 0
  while (offset < bytes.length) {
    let end = Math.min(offset + 75, bytes.length)
    while (end < bytes.length && (bytes[end]! & 0xC0) === 0x80) end--
    chunks.push(bytes.subarray(offset, end).toString('utf8'))
    offset = end
  }
  return chunks.join('\r\n ')
}

/** Génère un flux vCard 3.0 pour l'export complet du carnet d'adresses. */
export function generateVCard(contacts: ContactDetail[]): string {
  const lines: string[] = []

  for (const c of contacts) {
    lines.push('BEGIN:VCARD')
    lines.push('VERSION:3.0')
    lines.push(foldLine(`N:${escapeValue(c.lastName)};${escapeValue(c.firstName)};;;`))
    const fn = c.displayName.trim() || `${c.firstName} ${c.lastName}`.trim() || c.email
    lines.push(foldLine(`FN:${escapeValue(fn)}`))

    const emails = c.emails.length ? c.emails : [{ label: 'other' as EmailLabel, address: c.email }]
    for (const e of emails) {
      lines.push(foldLine(`EMAIL;TYPE=${e.label.toUpperCase()}:${escapeValue(e.address)}`))
    }
    for (const p of c.phones) {
      const type = p.label === 'mobile' ? 'CELL' : p.label.toUpperCase()
      lines.push(foldLine(`TEL;TYPE=${type}:${escapeValue(p.number)}`))
    }
    if (c.organization) lines.push(foldLine(`ORG:${escapeValue(c.organization)}`))
    if (c.jobTitle) lines.push(foldLine(`TITLE:${escapeValue(c.jobTitle)}`))
    if (c.birthday) lines.push(`BDAY:${c.birthday}`)
    if (c.notes) lines.push(foldLine(`NOTE:${escapeValue(c.notes)}`))
    lines.push('END:VCARD')
  }

  return `${lines.join('\r\n')}\r\n`
}
