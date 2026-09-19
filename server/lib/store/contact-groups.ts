import { z } from 'zod'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { ContactGroup } from '#shared/types/mail'

/** Groupe absent ou appartenant à un autre utilisateur (→ 404). */
export class ContactGroupNotFoundError extends Error {
  readonly statusCode = 404
  constructor() {
    super('Contact group not found')
    this.name = 'ContactGroupNotFoundError'
  }
}

/** Un groupe du même propriétaire porte déjà ce nom (→ 409). */
export class ContactGroupConflictError extends Error {
  readonly statusCode = 409
  constructor() {
    super('Contact group name already exists')
    this.name = 'ContactGroupConflictError'
  }
}

const nameSchema = z.string().trim().min(1, 'Nom requis').max(100, '100 caractères au maximum')
const contactIdsSchema = z.array(z.number().int().positive()).min(1).max(500)

interface GroupRow {
  id: number
  name: string
  member_count: number
}

function rowToGroup(row: GroupRow): ContactGroup {
  return { id: row.id, name: row.name, memberCount: row.member_count }
}

function getGroup(db: DatabaseSync, owner: string, id: number): ContactGroup {
  const row = db
    .prepare(
      `SELECT g.id, g.name, COUNT(m.contact_id) AS member_count
       FROM contact_groups g
       LEFT JOIN contact_group_members m ON m.group_id = g.id
       WHERE g.id = ? AND g.owner = ?
       GROUP BY g.id`
    )
    .get(id, owner) as unknown as GroupRow | undefined
  if (!row) throw new ContactGroupNotFoundError()
  return rowToGroup(row)
}

export function listGroups(db: DatabaseSync, owner: string): ContactGroup[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, COUNT(m.contact_id) AS member_count
       FROM contact_groups g
       LEFT JOIN contact_group_members m ON m.group_id = g.id
       WHERE g.owner = ?
       GROUP BY g.id
       ORDER BY g.name COLLATE NOCASE`
    )
    .all(owner) as unknown as GroupRow[]
  return rows.map(rowToGroup)
}

export function createGroup(db: DatabaseSync, owner: string, name: string): ContactGroup {
  const validated = nameSchema.parse(name)
  try {
    db.prepare('INSERT INTO contact_groups (owner, name, created_at) VALUES (?, ?, ?)').run(owner, validated, new Date().toISOString())
  }
  catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new ContactGroupConflictError()
    throw err
  }
  const row = db.prepare('SELECT id FROM contact_groups WHERE owner = ? AND name = ?').get(owner, validated) as { id: number }
  return getGroup(db, owner, row.id)
}

export function updateGroup(db: DatabaseSync, owner: string, id: number, name: string): ContactGroup {
  const validated = nameSchema.parse(name)
  const existing = db.prepare('SELECT id FROM contact_groups WHERE id = ? AND owner = ?').get(id, owner)
  if (!existing) throw new ContactGroupNotFoundError()

  try {
    db.prepare('UPDATE contact_groups SET name = ? WHERE id = ?').run(validated, id)
  }
  catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new ContactGroupConflictError()
    throw err
  }
  return getGroup(db, owner, id)
}

export function deleteGroup(db: DatabaseSync, owner: string, id: number): void {
  const result = db.prepare('DELETE FROM contact_groups WHERE id = ? AND owner = ?').run(id, owner)
  if (result.changes === 0) throw new ContactGroupNotFoundError()
}

/** Ajoute des membres. Les identifiants qui n'appartiennent pas au propriétaire sont ignorés (jamais de fuite entre comptes). */
export function addGroupMembers(db: DatabaseSync, owner: string, groupId: number, contactIds: number[]): void {
  const ids = contactIdsSchema.parse(contactIds)
  const group = db.prepare('SELECT id FROM contact_groups WHERE id = ? AND owner = ?').get(groupId, owner)
  if (!group) throw new ContactGroupNotFoundError()

  const insert = db.prepare(
    'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) SELECT ?, id FROM contacts WHERE id = ? AND owner = ?'
  )
  db.exec('BEGIN')
  try {
    for (const contactId of ids) insert.run(groupId, contactId, owner)
    db.exec('COMMIT')
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function removeGroupMembers(db: DatabaseSync, owner: string, groupId: number, contactIds: number[]): void {
  const ids = contactIdsSchema.parse(contactIds)
  const group = db.prepare('SELECT id FROM contact_groups WHERE id = ? AND owner = ?').get(groupId, owner)
  if (!group) throw new ContactGroupNotFoundError()

  const del = db.prepare('DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?')
  db.exec('BEGIN')
  try {
    for (const contactId of ids) del.run(groupId, contactId)
    db.exec('COMMIT')
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Groupes pour l'autocomplétion (`withGroups=1`), avec les adresses de leurs membres. */
export function searchGroupsWithEmails(db: DatabaseSync, owner: string, q: string | undefined, limit = 20): Array<{ id: number; name: string; emails: string[] }> {
  let sql = 'SELECT id, name FROM contact_groups WHERE owner = ?'
  const params: SQLInputValue[] = [owner]

  if (q && q.trim()) {
    const escaped = q.trim().toLowerCase().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    sql += ' AND LOWER(name) LIKE ? ESCAPE \'\\\''
    params.push(`${escaped}%`)
  }

  sql += ' ORDER BY name COLLATE NOCASE LIMIT ?'
  params.push(limit)

  const groups = db.prepare(sql).all(...params) as Array<{ id: number; name: string }>
  return groups.map((g) => {
    const members = db
      .prepare(
        `SELECT c.email FROM contact_group_members m
         JOIN contacts c ON c.id = m.contact_id
         WHERE m.group_id = ?
         ORDER BY c.name COLLATE NOCASE`
      )
      .all(g.id) as Array<{ email: string }>
    return { id: g.id, name: g.name, emails: members.map(m => m.email) }
  })
}
