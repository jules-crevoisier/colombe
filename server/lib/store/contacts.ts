import { z } from 'zod'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Contact, ContactInput } from '#shared/types/mail'

/** Contact absent ou appartenant à un autre utilisateur (→ 404). */
export class ContactNotFoundError extends Error {
  readonly statusCode = 404
  constructor() {
    super('Contact not found')
    this.name = 'ContactNotFoundError'
  }
}

const contactInputSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).default(''),
})

export function listContacts(db: DatabaseSync, owner: string, opts: { q?: string; limit?: number } = {}): Contact[] {
  const { q, limit = 20 } = opts

  let sql = 'SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE owner = ?'
  const params: SQLInputValue[] = [owner]

  if (q && q.trim()) {
    const searchTerm = q.trim().toLowerCase()
    // Escape LIKE wildcards
    const escaped = searchTerm.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    sql += ` AND (
      LOWER(email) LIKE ? ESCAPE '\\'
      OR LOWER(name) LIKE ? ESCAPE '\\'
      OR LOWER(name) LIKE ? ESCAPE '\\'
    )`
    params.push(
      `${escaped}%`, // email prefix
      `${escaped}%`, // name prefix
      `% ${escaped}%` // word in name
    )
  }

  sql += ' ORDER BY times_contacted DESC, last_contacted_at DESC, name LIMIT ?'
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number
    email: string
    name: string
    manual: number
    times_contacted: number
    last_contacted_at: string | null
  }>

  return rows.map(r => ({
    id: r.id,
    email: r.email,
    name: r.name,
    manual: r.manual === 1,
    timesContacted: r.times_contacted,
    lastContactedAt: r.last_contacted_at,
  }))
}

export function addContact(db: DatabaseSync, owner: string, input: ContactInput): Contact {
  const validated = contactInputSchema.parse(input)
  const email = validated.email.toLowerCase()

  // Upsert : un contact déjà collecté devient manuel sans perdre son historique ni son id.
  db.prepare(
    `INSERT INTO contacts (owner, email, name, manual, times_contacted, last_contacted_at) VALUES (?, ?, ?, 1, 0, NULL)
     ON CONFLICT(owner, email) DO UPDATE SET manual = 1, name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE contacts.name END`
  ).run(owner, email, validated.name)

  const row = db.prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE owner = ? AND email = ?').get(
    owner,
    email
  ) as {
    id: number
    email: string
    name: string
    manual: number
    times_contacted: number
    last_contacted_at: string | null
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    manual: row.manual === 1,
    timesContacted: row.times_contacted,
    lastContactedAt: row.last_contacted_at,
  }
}

export function updateContact(db: DatabaseSync, owner: string, id: number, patch: { name?: string }): Contact {
  const existing = db
    .prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE id = ? AND owner = ?')
    .get(id, owner) as
    | {
        id: number
        email: string
        name: string
        manual: number
        times_contacted: number
        last_contacted_at: string | null
      }
    | undefined

  if (!existing) {
    throw new ContactNotFoundError()
  }

  if (patch.name !== undefined) {
    const validated = z.string().max(200).parse(patch.name)
    db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(validated, id)
  }

  const updated = db
    .prepare('SELECT id, email, name, manual, times_contacted, last_contacted_at FROM contacts WHERE id = ?')
    .get(id) as {
    id: number
    email: string
    name: string
    manual: number
    times_contacted: number
    last_contacted_at: string | null
  }

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    manual: updated.manual === 1,
    timesContacted: updated.times_contacted,
    lastContactedAt: updated.last_contacted_at,
  }
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

      const existing = db
        .prepare('SELECT id, name FROM contacts WHERE owner = ? AND email = ?')
        .get(owner, email) as
        | {
            id: number
            name: string
          }
        | undefined

      if (existing) {
        // Update existing contact: increment times_contacted, update last_contacted_at, and optionally update name
        const newName = addr.name && addr.name.trim() ? (existing.name.trim() ? existing.name : addr.name) : existing.name
        db.prepare(
          'UPDATE contacts SET times_contacted = times_contacted + 1, last_contacted_at = ?, name = ? WHERE id = ?'
        ).run(now, newName, existing.id)
      } else {
        // Create new contact: manual = 0, times_contacted = 1
        db.prepare(
          'INSERT INTO contacts (owner, email, name, manual, times_contacted, last_contacted_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(owner, email, addr.name?.trim() || '', 0, 1, now)
      }
    }

    db.prepare('COMMIT').run()
  } catch (err) {
    db.prepare('ROLLBACK').run()
    throw err
  }
}
