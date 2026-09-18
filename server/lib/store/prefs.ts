import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'
import type { Prefs } from '#shared/types/mail'
import { DEFAULT_PREFS } from '#shared/types/mail'
import { sanitizeOutgoingHtml } from '../mail/sanitize-outgoing'

const prefsSchema = z.object({
  signatureHtml: z.string().max(10000).default(''),
  signatureEnabled: z.boolean().default(false),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]).default(5),
  conversationView: z.boolean().default(true),
  desktopNotifications: z.boolean().default(false),
}).strict()

export function getPrefs(db: DatabaseSync, owner: string): Prefs {
  const row = db.prepare('SELECT json FROM prefs WHERE owner = ?').get(owner) as { json: string } | undefined
  if (!row) {
    return DEFAULT_PREFS
  }

  const stored = JSON.parse(row.json) as unknown
  const partial = prefsSchema.partial().parse(stored)

  return {
    ...DEFAULT_PREFS,
    ...partial,
  }
}

export function savePrefs(db: DatabaseSync, owner: string, patch: Partial<Prefs>): Prefs {
  const current = getPrefs(db, owner)
  const merged = { ...current, ...patch }

  // Validate the complete merged object
  const validated = prefsSchema.parse(merged)

  // Sanitize signatureHtml if provided in patch
  const sanitizedSig = validated.signatureHtml ? sanitizeOutgoingHtml(validated.signatureHtml) : validated.signatureHtml

  const finalPrefs: Prefs = {
    ...validated,
    signatureHtml: sanitizedSig,
  }

  db.prepare('INSERT OR REPLACE INTO prefs (owner, json, updated_at) VALUES (?, ?, ?)').run(
    owner,
    JSON.stringify(finalPrefs),
    new Date().toISOString()
  )

  return finalPrefs
}
