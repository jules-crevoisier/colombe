import { z } from 'zod'
import type { DatabaseSync } from 'node:sqlite'
import type { Identity, IdentityInput } from '#shared/types/mail'
import { MAX_SIGNATURE_IMAGES, sanitizeOutgoingHtml } from '../mail/sanitize-outgoing'
import { getPrefs } from './prefs'
import type { LocalizedMessage } from '../i18n'

/** 20 identités max par utilisateur (ROADMAP R2.1). */
export const MAX_IDENTITIES = 20
/** Signature HTML : 1 Mo max (ROADMAP R2.1b). */
const MAX_SIGNATURE_BYTES = 1_000_000

/** Identité absente ou appartenant à un autre utilisateur (→ 404). */
export class IdentityNotFoundError extends Error {
  readonly statusCode = 404
  readonly i18n: LocalizedMessage = { key: 'identities.notFound' }
  constructor() {
    super('Identité introuvable.')
    this.name = 'IdentityNotFoundError'
  }
}

export class IdentityLimitError extends Error {
  readonly statusCode = 400
  readonly i18n: LocalizedMessage = { key: 'identities.limit', params: { max: MAX_IDENTITIES } }
  constructor() {
    super(`Nombre maximal d'identités atteint (${MAX_IDENTITIES}).`)
    this.name = 'IdentityLimitError'
  }
}

/** On ne peut jamais supprimer la dernière identité restante. */
export class LastIdentityError extends Error {
  readonly statusCode = 400
  readonly i18n: LocalizedMessage = { key: 'identities.last' }
  constructor() {
    super('Impossible de supprimer la dernière identité.')
    this.name = 'LastIdentityError'
  }
}

const emailOrEmpty = z.string().trim().max(320).refine(
  v => v === '' || z.email().safeParse(v).success,
  { message: 'Adresse e-mail invalide.' }
)

const identityFields = {
  name: z.string().trim().max(200),
  replyTo: emailOrEmpty,
  bcc: emailOrEmpty,
  organization: z.string().trim().max(200),
  signatureHtml: z.string().max(MAX_SIGNATURE_BYTES),
  isDefault: z.boolean(),
}

const createIdentitySchema = z.object({
  name: identityFields.name.default(''),
  replyTo: identityFields.replyTo.default(''),
  bcc: identityFields.bcc.default(''),
  organization: identityFields.organization.default(''),
  signatureHtml: identityFields.signatureHtml.default(''),
  isDefault: identityFields.isDefault.default(false),
}).strict()

const patchIdentitySchema = z.object(identityFields).partial().strict()

interface IdentityRow {
  id: number
  name: string
  reply_to: string
  bcc: string
  organization: string
  signature_html: string
  is_default: number
}

const SELECT_COLUMNS = 'id, name, reply_to, bcc, organization, signature_html, is_default'

function rowToIdentity(row: IdentityRow, email: string): Identity {
  return {
    id: row.id,
    name: row.name,
    email,
    replyTo: row.reply_to,
    bcc: row.bcc,
    organization: row.organization,
    // Assaini aussi à la lecture : des lignes peuvent venir d'un import direct en base
    // (scripts/import-roundcube.mjs), sans passer par l'API.
    signatureHtml: sanitizeSignature(row.signature_html),
    isDefault: row.is_default === 1,
  }
}

function sanitizeSignature(html: string): string {
  return html ? sanitizeOutgoingHtml(html, { maxImages: MAX_SIGNATURE_IMAGES }) : ''
}

/**
 * Liste les identités de l'utilisateur ; en crée une par défaut à la toute
 * première lecture (ROADMAP R2.1) : nom = partie locale du login, signature =
 * `Prefs.signatureHtml` existante s'il y en avait une (compatibilité v2).
 */
export function ensureIdentities(db: DatabaseSync, owner: string): Identity[] {
  const existing = db.prepare(`SELECT ${SELECT_COLUMNS} FROM identities WHERE owner = ? ORDER BY id ASC`).all(owner) as unknown as IdentityRow[]
  if (existing.length > 0) return existing.map(r => rowToIdentity(r, owner))

  const prefs = getPrefs(db, owner)
  const localPart = owner.split('@')[0] || owner

  db.prepare(
    `INSERT INTO identities (owner, name, reply_to, bcc, organization, signature_html, is_default, created_at)
     VALUES (?, ?, '', '', '', ?, 1, ?)`
  ).run(owner, localPart, prefs.signatureHtml, new Date().toISOString())

  const created = db.prepare(`SELECT ${SELECT_COLUMNS} FROM identities WHERE owner = ? ORDER BY id ASC`).all(owner) as unknown as IdentityRow[]
  return created.map(r => rowToIdentity(r, owner))
}

/** Identité par défaut de l'utilisateur (la crée si nécessaire). Toujours non nulle. */
export function getDefaultIdentity(db: DatabaseSync, owner: string): Identity {
  const identities = ensureIdentities(db, owner)
  return identities.find(i => i.isDefault) ?? identities[0]!
}

/** Identité par id, `null` si absente ou appartenant à un autre utilisateur. */
export function findIdentity(db: DatabaseSync, owner: string, id: number): Identity | null {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM identities WHERE id = ? AND owner = ?`).get(id, owner) as unknown as IdentityRow | undefined
  return row ? rowToIdentity(row, owner) : null
}

export function addIdentity(db: DatabaseSync, owner: string, input: IdentityInput): Identity {
  const validated = createIdentitySchema.parse(input)
  const count = (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE owner = ?').get(owner) as { n: number }).n
  if (count >= MAX_IDENTITIES) throw new IdentityLimitError()

  const signatureHtml = sanitizeSignature(validated.signatureHtml)
  // La toute première identité de l'utilisateur devient forcément la par défaut.
  const makeDefault = count === 0 || validated.isDefault

  db.exec('BEGIN')
  try {
    if (makeDefault) db.prepare('UPDATE identities SET is_default = 0 WHERE owner = ?').run(owner)
    db.prepare(
      `INSERT INTO identities (owner, name, reply_to, bcc, organization, signature_html, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(owner, validated.name, validated.replyTo, validated.bcc, validated.organization, signatureHtml, makeDefault ? 1 : 0, new Date().toISOString())
    db.exec('COMMIT')
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM identities WHERE owner = ? ORDER BY id DESC LIMIT 1`).get(owner) as unknown as IdentityRow
  return rowToIdentity(row, owner)
}

export function updateIdentity(db: DatabaseSync, owner: string, id: number, patch: Partial<IdentityInput>): Identity {
  const existing = db.prepare(`SELECT ${SELECT_COLUMNS} FROM identities WHERE id = ? AND owner = ?`).get(id, owner) as unknown as IdentityRow | undefined
  if (!existing) throw new IdentityNotFoundError()

  const validated = patchIdentitySchema.parse(patch)
  const nextSignature = validated.signatureHtml !== undefined ? sanitizeSignature(validated.signatureHtml) : existing.signature_html

  db.exec('BEGIN')
  try {
    if (validated.isDefault === true) {
      db.prepare('UPDATE identities SET is_default = 0 WHERE owner = ?').run(owner)
    }
    db.prepare(
      `UPDATE identities SET name = ?, reply_to = ?, bcc = ?, organization = ?, signature_html = ?, is_default = ? WHERE id = ?`
    ).run(
      validated.name ?? existing.name,
      validated.replyTo ?? existing.reply_to,
      validated.bcc ?? existing.bcc,
      validated.organization ?? existing.organization,
      nextSignature,
      validated.isDefault !== undefined ? (validated.isDefault ? 1 : 0) : existing.is_default,
      id
    )
    // Invariant : il doit toujours rester exactement une identité par défaut.
    const stillDefault = (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE owner = ? AND is_default = 1').get(owner) as { n: number }).n
    if (stillDefault === 0) db.prepare('UPDATE identities SET is_default = 1 WHERE id = ?').run(id)
    db.exec('COMMIT')
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const updated = db.prepare(`SELECT ${SELECT_COLUMNS} FROM identities WHERE id = ?`).get(id) as unknown as IdentityRow
  return rowToIdentity(updated, owner)
}

export function deleteIdentity(db: DatabaseSync, owner: string, id: number): void {
  const rows = db.prepare('SELECT id, is_default FROM identities WHERE owner = ? ORDER BY id ASC').all(owner) as Array<{ id: number; is_default: number }>
  const target = rows.find(r => r.id === id)
  if (!target) throw new IdentityNotFoundError()
  if (rows.length <= 1) throw new LastIdentityError()

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM identities WHERE id = ? AND owner = ?').run(id, owner)
    if (target.is_default === 1) {
      // La plus ancienne identité restante devient la par défaut.
      const oldest = rows.find(r => r.id !== id)
      if (oldest) db.prepare('UPDATE identities SET is_default = 1 WHERE id = ?').run(oldest.id)
    }
    db.exec('COMMIT')
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
