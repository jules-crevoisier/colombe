/**
 * CSV minimal pour l'import du carnet d'adresses (R2.3) : en-têtes
 * `Prénom,Nom,E-mail,Téléphone,Organisation`, séparateur `;` ou `,` détecté
 * automatiquement, champs entre guillemets pris en charge (RFC 4180), UTF-8.
 */

export interface CsvContact {
  firstName: string
  lastName: string
  email: string
  phone: string
  organization: string
}

type CsvField = keyof CsvContact

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const HEADER_MAP: Record<string, CsvField> = {
  'prenom': 'firstName',
  'nom': 'lastName',
  'e-mail': 'email',
  'email': 'email',
  'telephone': 'phone',
  'organisation': 'organization',
}

function detectSeparator(firstLine: string): string {
  const semi = (firstLine.match(/;/g) ?? []).length
  const comma = (firstLine.match(/,/g) ?? []).length
  return semi > comma ? ';' : ','
}

/** Analyseur RFC 4180 : guillemets doublés, séparateur et retours à la ligne dans un champ cité. */
function parseCsvRows(content: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        }
        else {
          inQuotes = false
        }
      }
      else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === separator) {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += ch
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter(r => r.some(c => c.trim().length > 0))
}

export function parseContactsCsv(content: string): CsvContact[] {
  const withoutBom = content.replace(/^﻿/, '')
  const firstLineEnd = withoutBom.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? withoutBom : withoutBom.slice(0, firstLineEnd)
  const separator = detectSeparator(firstLine)
  const rows = parseCsvRows(withoutBom, separator)
  if (!rows.length) return []

  const header = (rows[0] ?? []).map(normalizeHeader)
  const contacts: CsvContact[] = []

  for (const row of rows.slice(1)) {
    const record: CsvContact = { firstName: '', lastName: '', email: '', phone: '', organization: '' }
    header.forEach((h, idx) => {
      const key = HEADER_MAP[h]
      if (key) record[key] = (row[idx] ?? '').trim()
    })
    contacts.push(record)
  }

  return contacts
}
