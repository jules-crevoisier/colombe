import { z } from 'zod'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Contact, ContactDetail, ContactDetailInput, ContactInput, EmailLabel, PhoneLabel } from '#shared/types/mail'

/** Contact absent ou appartenant à un autre utilisateur (→ 404). */
export class ContactNotFoundError extends Error {
  readonly statusCode = 404
  constructor() {
    super('Contact not found')
    this.name = 'ContactNotFoundError'
  }
}

/** Une autre fiche du même propriétaire utilise déjà cette adresse principale (→ 409). */
export class ContactEmailConflictError extends Error {
  readonly statusCode = 409
  constructor() {
    super('Contact email already in use')
    this.name = 'ContactEmailConflictError'
  }
}

const contactInputSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).default(''),
})

const emailLabelSchema = z.enum(['home', 'work', 'other'])
const phoneLabelSchema = z.enum(['home', 'work', 'mobile', 'other'])

const postalAddressSchema = z.object({
  street: z.string().max(200).default(''),
  postalCode: z.string().max(20).default(''),
  city: z.string().max(100).default(''),
  country: z.string().max(100).default(''),
})

export const contactDetailInputSchema = z.object({
  firstName: z.string().max(100).default(''),
  lastName: z.string().max(100).default(''),
  displayName: z.string().max(200).default(''),
  emails: z.array(z.object({ label: emailLabelSchema, address: z.string().email() })).min(1, 'Au moins une adresse requise').max(20),
  phones: z.array(z.object({ label: phoneLabelSchema, number: z.string().max(50) })).max(20).default([]),
  organization: z.string().max(200).default(''),
  jobTitle: z.string().max(200).default(''),
  address: z.union([postalAddressSchema, z.null()]).default(null),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-JJ attendu').nullable().default(null),
  notes: z.string().max(5000).default(''),
})

interface ContactRow {
  id: number
  email: string
  name: string
  manual: number
  times_contacted: number
  last_contacted_at: string | null
}

interface StoredDetails {
  firstName?: string
  lastName?: string
  displayName?: string
  phones?: Array<{ label: PhoneLabel; number: string }>
  organization?: string
  jobTitle?: string
  address?: ContactDetailInput['address']
  birthday?: string | null
  notes?: string
}

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    manual: row.manual === 1,
    timesContacted: row.times_contacted,
    lastContactedAt: row.last_contacted_at,
  }
}

/**
 * Retrouve un contact du propriétaire par n'importe laquelle de ses adresses
 * (principale `contacts.email` OU secondaire `contact_emails`), pour ne jamais
 * dupliquer une même personne (R2.3).
 */
function findContactIdByAnyEmail(db: DatabaseSync, owner: string, email: string): number | null {
  const row = db
    .prepare(
      `SELECT c.id FROM contacts c WHERE c.owner = ? AND c.email = ?
       UNION
       SELECT c.id FROM contacts c JOIN contact_emails ce ON ce.contact_id = c.id WHERE c.owner = ? AND ce.address = ?
       LIMIT 1`
    )
    .get(owner, email, owner, email) as { id: number } | undefined
  return row ? row.id : null
}

/**
 * Crée la ligne `contact_emails` position 0 (adresse principale) si le contact
 * n'a encore aucune adresse enregistrée. Ne touche jamais une fiche déjà
 * détaillée (on ne veut pas écraser un libellé choisi par l'utilisateur).
 */
function ensurePrimaryEmailRow(db: DatabaseSync, contactId: number, email: string): void {
  const exists = db.prepare('SELECT 1 FROM contact_emails WHERE contact_id = ? AND position = 0').get(contactId)
  if (!exists) {
    db.prepare('INSERT INTO contact_emails (contact_id, position, label, address) VALUES (?, 0, \'other\', ?)').run(contactId, email)
  }
}

/**
 * L'adresse appartient-elle à un contact du propriétaire (ajouté à la main OU
 * collecté), qu'elle soit son adresse principale ou une adresse secondaire ?
 * Utilisé par `MessageDetail.senderInContacts` (R2.8).
 */
export function isKnownContact(db: DatabaseSync, owner: string, email: string): boolean {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  return findContactIdByAnyEmail(db, owner, normalized) !== null
}

export interface ListContactsOptions {
  q?: string
  limit?: number
  /** 'collected' : seulement les adresses collectées automatiquement (manual = 0). */
  scope?: 'all' | 'collected'
  /** Membres d'un groupe de l'utilisateur. */
  groupId?: number
}

export function listContacts(db: DatabaseSync, owner: string, opts: ListContactsOptions = {}): Contact[] {
  const { q, limit = 20, scope = 'all', groupId } = opts

  // LEFT JOIN contact_emails : l'autocomplétion doit aussi trouver un contact
  // par une adresse secondaire, sans jamais renvoyer la même personne deux fois
  // (DISTINCT porte sur les colonnes de `contacts`, stables par contact).
  let sql = `SELECT DISTINCT c.id, c.email, c.name, c.manual, c.times_contacted, c.last_contacted_at
    FROM contacts c
    LEFT JOIN contact_emails ce ON ce.contact_id = c.id
    WHERE c.owner = ?`
  const params: SQLInputValue[] = [owner]

  if (scope === 'collected') sql += ' AND c.manual = 0'
  if (groupId !== undefined) {
    // Le groupe doit appartenir au même utilisateur.
    sql += ` AND c.id IN (
      SELECT m.contact_id FROM contact_group_members m
      JOIN contact_groups g ON g.id = m.group_id
      WHERE g.id = ? AND g.owner = ?
    )`
    params.push(groupId, owner)
  }

  if (q && q.trim()) {
    const searchTerm = q.trim().toLowerCase()
    // Escape LIKE wildcards
    const escaped = searchTerm.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    sql += ` AND (
      LOWER(c.email) LIKE ? ESCAPE '\\'
      OR LOWER(c.name) LIKE ? ESCAPE '\\'
      OR LOWER(c.name) LIKE ? ESCAPE '\\'
      OR LOWER(ce.address) LIKE ? ESCAPE '\\'
    )`
    params.push(
      `${escaped}%`, // email prefix
      `${escaped}%`, // name prefix
      `% ${escaped}%`, // word in name
      `${escaped}%` // secondary email prefix
    )
  }

  sql += ' ORDER BY c.times_contacted DESC, c.last_contacted_at DESC, c.name LIMIT ?'
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as unknown as ContactRow[]
  return rows.map(rowToContact)
}

export function addContact(db: DatabaseSync, owner: string, input: ContactInput): Contact {
  const validated = contactInputSchema.parse(input)
  const email = validated.email.toLowerCase()

  // Un contact déjà collecté (ou possédant cette adresse en secondaire) devient
  // manuel sans perdre son historique ni son id — jamais de doublon.
  let contactId = findContactIdByAnyEmail(db, owner, email)
  if (contactId) {
    db.prepare('UPDATE contacts SET manual = 1, name = CASE WHEN ? <> \'\' THEN ? ELSE name END WHERE id = ?').run(
      validated.name,
      validated.name,
      contactId
    )
  }
  else {
    db.prepare(
      'INSERT INTO contacts (owner, email, name, manual, times_contacted, last_contacted_at) VALUES (?, ?, ?, 1, 0, NULL)'
    ).run(owner, email, validated.name)
    const created = db.prepare('SELECT id FROM contacts WHERE owner = ? AND email = ?').get(owner, email) as { id: number }
    contactId = created.id
    ensurePrimaryEmailRow(db, contactId, email)
  }

  const row = db
    .prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE id = ?')
    .get(contactId) as unknown as ContactRow
  return rowToContact(row)
}

export function updateContact(db: DatabaseSync, owner: string, id: number, patch: { name?: string }): Contact {
  const existing = db
    .prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE id = ? AND owner = ?')
    .get(id, owner) as unknown as ContactRow | undefined

  if (!existing) {
    throw new ContactNotFoundError()
  }

  if (patch.name !== undefined) {
    const validated = z.string().max(200).parse(patch.name)
    db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(validated, id)
  }

  const updated = db.prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE id = ?').get(id) as unknown as ContactRow

  return rowToContact(updated)
}

export function deleteContact(db: DatabaseSync, owner: string, id: number): void {
  const result = db.prepare('DELETE FROM contacts WHERE id = ? AND owner = ?').run(id, owner)
  if (result.changes === 0) {
    throw new ContactNotFoundError()
  }
}

export function recordRecipients(
  db: DatabaseSync,
  owner: string,
  addresses: Array<{ email: string; name?: string }>
): void {
  db.prepare('BEGIN').run()

  try {
    const now = new Date().toISOString()

    for (const addr of addresses) {
      const email = addr.email.toLowerCase()

      // Skip the owner's own email
      if (email === owner.toLowerCase()) {
        continue
      }

      const existingId = findContactIdByAnyEmail(db, owner, email)

      if (existingId) {
        const existing = db.prepare('SELECT name FROM contacts WHERE id = ?').get(existingId) as { name: string }
        const newName = addr.name && addr.name.trim() ? (existing.name.trim() ? existing.name : addr.name) : existing.name
        db.prepare(
          'UPDATE contacts SET times_contacted = times_contacted + 1, last_contacted_at = ?, name = ? WHERE id = ?'
        ).run(now, newName, existingId)
      }
      else {
        // Create new contact: manual = 0, times_contacted = 1
        db.prepare(
          'INSERT INTO contacts (owner, email, name, manual, times_contacted, last_contacted_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(owner, email, addr.name?.trim() || '', 0, 1, now)
        const created = db.prepare('SELECT id FROM contacts WHERE owner = ? AND email = ?').get(owner, email) as { id: number }
        ensurePrimaryEmailRow(db, created.id, email)
      }
    }

    db.prepare('COMMIT').run()
  }
  catch (err) {
    db.prepare('ROLLBACK').run()
    throw err
  }
}

function parseDetails(json: string): StoredDetails {
  try {
    return JSON.parse(json || '{}') as StoredDetails
  }
  catch {
    return {}
  }
}

/** Charge la fiche complète (R2.3) : adresse principale, secondaires, groupes. */
export function getContactDetail(db: DatabaseSync, owner: string, id: number): ContactDetail {
  const row = db
    .prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at, details FROM contacts WHERE id = ? AND owner = ?')
    .get(id, owner) as (ContactRow & { details: string }) | undefined
  if (!row) throw new ContactNotFoundError()

  const emailRows = db
    .prepare('SELECT label, address FROM contact_emails WHERE contact_id = ? ORDER BY position')
    .all(id) as Array<{ label: string; address: string }>
  const groupRows = db.prepare('SELECT group_id FROM contact_group_members WHERE contact_id = ?').all(id) as Array<{ group_id: number }>

  const details = parseDetails(row.details)
  const emails = emailRows.length
    ? emailRows.map(e => ({ label: e.label as EmailLabel, address: e.address }))
    : [{ label: 'other' as EmailLabel, address: row.email }]

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    manual: row.manual === 1,
    timesContacted: row.times_contacted,
    lastContactedAt: row.last_contacted_at,
    firstName: details.firstName ?? '',
    lastName: details.lastName ?? '',
    displayName: details.displayName ?? '',
    emails,
    phones: details.phones ?? [],
    organization: details.organization ?? '',
    jobTitle: details.jobTitle ?? '',
    address: details.address ?? null,
    birthday: details.birthday ?? null,
    notes: details.notes ?? '',
    groupIds: groupRows.map(g => g.group_id),
  }
}

/** Remplace la fiche complète d'un contact existant (PUT /api/contacts/:id). */
export function updateContactDetail(db: DatabaseSync, owner: string, id: number, input: ContactDetailInput): ContactDetail {
  const validated = contactDetailInputSchema.parse(input)
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ? AND owner = ?').get(id, owner)
  if (!existing) throw new ContactNotFoundError()

  const primaryEmail = (validated.emails[0] as { label: EmailLabel; address: string }).address.toLowerCase()
  const displayName = validated.displayName.trim() || `${validated.firstName} ${validated.lastName}`.trim()
  const details: StoredDetails = {
    firstName: validated.firstName,
    lastName: validated.lastName,
    displayName: validated.displayName,
    phones: validated.phones,
    organization: validated.organization,
    jobTitle: validated.jobTitle,
    address: validated.address,
    birthday: validated.birthday,
    notes: validated.notes,
  }

  db.exec('BEGIN')
  try {
    try {
      db.prepare('UPDATE contacts SET email = ?, name = ?, details = ? WHERE id = ?').run(primaryEmail, displayName, JSON.stringify(details), id)
    }
    catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new ContactEmailConflictError()
      throw err
    }
    db.prepare('DELETE FROM contact_emails WHERE contact_id = ?').run(id)
    const insertEmail = db.prepare('INSERT INTO contact_emails (contact_id, position, label, address) VALUES (?, ?, ?, ?)')
    validated.emails.forEach((e, index) => insertEmail.run(id, index, e.label, e.address.toLowerCase()))
    db.exec('COMMIT')
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return getContactDetail(db, owner, id)
}

/** Toutes les fiches complètes du propriétaire, triées par nom (export .vcf). */
export function listAllContactDetails(db: DatabaseSync, owner: string): ContactDetail[] {
  const rows = db.prepare('SELECT id FROM contacts WHERE owner = ? ORDER BY name COLLATE NOCASE').all(owner) as Array<{ id: number }>
  return rows.map(r => getContactDetail(db, owner, r.id))
}

export interface ImportedContactRecord {
  firstName: string
  lastName: string
  displayName: string
  emails: Array<{ label: EmailLabel; address: string }>
  phones: Array<{ label: PhoneLabel; number: string }>
  organization: string
  jobTitle: string
  birthday: string | null
}

/**
 * Fusionne un contact importé (.vcf / .csv) avec une fiche existante trouvée
 * par n'importe laquelle de ses adresses, sans jamais dupliquer une personne.
 * Politique de fusion : on complète les champs vides, on ne remplace jamais un
 * champ déjà renseigné par l'utilisateur. Un contact fusionné compte comme
 * « importé » (pas « ignoré ») dans `ContactImportResult` : ses données ont
 * bien été prises en compte, juste rattachées à une fiche existante.
 */
export function mergeImportedContact(db: DatabaseSync, owner: string, record: ImportedContactRecord): void {
  const normalizedEmails = record.emails
    .map(e => ({ label: e.label, address: e.address.trim().toLowerCase() }))
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.address))
  if (!normalizedEmails.length) return

  let contactId: number | null = null
  for (const e of normalizedEmails) {
    contactId = findContactIdByAnyEmail(db, owner, e.address)
    if (contactId) break
  }

  const displayName = record.displayName.trim() || `${record.firstName} ${record.lastName}`.trim()

  if (contactId) {
    const existing = getContactDetail(db, owner, contactId)
    const mergedEmails = [...existing.emails]
    for (const e of normalizedEmails) {
      if (!mergedEmails.some(m => m.address === e.address)) mergedEmails.push(e)
    }
    updateContactDetail(db, owner, contactId, {
      firstName: existing.firstName || record.firstName,
      lastName: existing.lastName || record.lastName,
      displayName: existing.displayName || displayName,
      emails: mergedEmails,
      phones: existing.phones.length ? existing.phones : record.phones,
      organization: existing.organization || record.organization,
      jobTitle: existing.jobTitle || record.jobTitle,
      address: existing.address,
      birthday: existing.birthday || record.birthday,
      notes: existing.notes,
    })
    db.prepare('UPDATE contacts SET manual = 1 WHERE id = ?').run(contactId)
  }
  else {
    const primary = normalizedEmails[0] as { label: EmailLabel; address: string }
    db.prepare(
      'INSERT INTO contacts (owner, email, name, manual, times_contacted, last_contacted_at) VALUES (?, ?, ?, 1, 0, NULL)'
    ).run(owner, primary.address, displayName)
    const created = db.prepare('SELECT id FROM contacts WHERE owner = ? AND email = ?').get(owner, primary.address) as { id: number }
    updateContactDetail(db, owner, created.id, {
      firstName: record.firstName,
      lastName: record.lastName,
      displayName: record.displayName,
      emails: normalizedEmails,
      phones: record.phones,
      organization: record.organization,
      jobTitle: record.jobTitle,
      address: null,
      birthday: record.birthday,
      notes: '',
    })
  }
}
