import { z } from 'zod'
import type { DatabaseSync } from 'node:sqlite'
import type { CannedResponse, CannedResponseInput } from '#shared/types/mail'
import { sanitizeOutgoingHtml } from '../mail/sanitize-outgoing'

/** 100 réponses types max par utilisateur (ROADMAP R2.2). */
export const MAX_RESPONSES = 100
/** Contenu HTML : 1 Mo max, comme une signature (ROADMAP R2.1b / R2.2). */
const MAX_HTML_BYTES = 1_000_000

export class ResponseNotFoundError extends Error {
  readonly statusCode = 404
  constructor() {
    super('Réponse type introuvable.')
    this.name = 'ResponseNotFoundError'
  }
}

export class ResponseLimitError extends Error {
  readonly statusCode = 400
  constructor() {
    super(`Nombre maximal de réponses types atteint (${MAX_RESPONSES}).`)
    this.name = 'ResponseLimitError'
  }
}

const responseFields = {
  name: z.string().trim().min(1).max(100),
  html: z.string().max(MAX_HTML_BYTES),
}

const createResponseSchema = z.object(responseFields).strict()
const patchResponseSchema = z.object(responseFields).partial().strict()

interface ResponseRow {
  id: number
  name: string
  html: string
}

function rowToResponse(row: ResponseRow): CannedResponse {
  return { id: row.id, name: row.name, html: row.html }
}

export function listResponses(db: DatabaseSync, owner: string): CannedResponse[] {
  const rows = db.prepare('SELECT id, name, html FROM responses WHERE owner = ? ORDER BY id ASC').all(owner) as unknown as ResponseRow[]
  return rows.map(rowToResponse)
}

export function addResponse(db: DatabaseSync, owner: string, input: CannedResponseInput): CannedResponse {
  const validated = createResponseSchema.parse(input)
  const count = (db.prepare('SELECT COUNT(*) AS n FROM responses WHERE owner = ?').get(owner) as { n: number }).n
  if (count >= MAX_RESPONSES) throw new ResponseLimitError()

  const html = validated.html ? sanitizeOutgoingHtml(validated.html) : ''
  db.prepare('INSERT INTO responses (owner, name, html, created_at) VALUES (?, ?, ?, ?)')
    .run(owner, validated.name, html, new Date().toISOString())

  const row = db.prepare('SELECT id, name, html FROM responses WHERE owner = ? ORDER BY id DESC LIMIT 1').get(owner) as unknown as ResponseRow
  return rowToResponse(row)
}

export function updateResponse(db: DatabaseSync, owner: string, id: number, patch: Partial<CannedResponseInput>): CannedResponse {
  const existing = db.prepare('SELECT id, name, html FROM responses WHERE id = ? AND owner = ?').get(id, owner) as unknown as ResponseRow | undefined
  if (!existing) throw new ResponseNotFoundError()

  const validated = patchResponseSchema.parse(patch)
  const nextHtml = validated.html !== undefined ? (validated.html ? sanitizeOutgoingHtml(validated.html) : '') : existing.html

  db.prepare('UPDATE responses SET name = ?, html = ? WHERE id = ?').run(validated.name ?? existing.name, nextHtml, id)

  const updated = db.prepare('SELECT id, name, html FROM responses WHERE id = ?').get(id) as unknown as ResponseRow
  return rowToResponse(updated)
}

export function deleteResponse(db: DatabaseSync, owner: string, id: number): void {
  const result = db.prepare('DELETE FROM responses WHERE id = ? AND owner = ?').run(id, owner)
  if (result.changes === 0) throw new ResponseNotFoundError()
}
