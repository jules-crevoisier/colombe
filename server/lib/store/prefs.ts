import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'
import type { Prefs } from '#shared/types/mail'
import { DEFAULT_PREFS } from '#shared/types/mail'
import { MAX_SIGNATURE_IMAGES, sanitizeOutgoingHtml } from '../mail/sanitize-outgoing'

/** `signatureHtml` : 1 Mo max, comme une signature d'identité (ROADMAP R2.1b / R2.8). */
const MAX_SIGNATURE_BYTES = 1_000_000

const specialFoldersSchema = z.object({
  sent: z.string().max(512),
  drafts: z.string().max(512),
  trash: z.string().max(512),
  junk: z.string().max(512),
  archive: z.string().max(512),
})

/**
 * Forme complète de `Prefs`. Volontairement NON stricte : sert aussi à relire
 * du JSON stocké par une version antérieure, qui peut contenir des clés
 * disparues depuis (elles sont simplement ignorées, jamais un échec).
 * La validation « clé inconnue → 400 » se fait à la frontière HTTP
 * (schéma strict de `PUT /api/prefs`), pas ici.
 */
const prefsSchema = z.object({
  signatureHtml: z.string().max(MAX_SIGNATURE_BYTES),
  signatureEnabled: z.boolean(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  density: z.enum(['comfortable', 'compact']),
  undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]),
  conversationView: z.boolean(),
  desktopNotifications: z.boolean(),
  readingPane: z.enum(['none', 'right']),
  markReadDelay: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(-1)]),
  preferHtml: z.boolean(),
  remoteImages: z.enum(['never', 'contacts', 'always']),
  timeZone: z.string().min(1).max(100),
  dateFormat: z.enum(['relative', 'short', 'long']),
  timeFormat: z.enum(['24h', '12h']),
  replyPosition: z.enum(['above', 'below']),
  composeHtml: z.boolean(),
  logoutEmptyTrash: z.boolean(),
  logoutExpunge: z.boolean(),
  deleteMode: z.enum(['trash', 'permanent']),
  specialFolders: specialFoldersSchema,
  idleMinutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
  threadList: z.boolean(),
  welcomed: z.boolean(),
  language: z.enum(['auto', 'fr', 'en']),
})

export function getPrefs(db: DatabaseSync, owner: string): Prefs {
  const row = db.prepare('SELECT json FROM prefs WHERE owner = ?').get(owner) as { json: string } | undefined
  if (!row) {
    return DEFAULT_PREFS
  }

  const stored = JSON.parse(row.json) as unknown
  // `.partial()` : ne valide que les clés présentes ; celles d'une version
  // plus ancienne du contrat sont ignorées, celles manquantes prendront les valeurs par défaut.
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

  // Sanitize signatureHtml if provided in patch (mêmes règles qu'une signature d'identité :
  // elle y est recopiée à la création de l'identité par défaut — R2.8).
  const sanitizedSig = validated.signatureHtml ? sanitizeOutgoingHtml(validated.signatureHtml, { maxImages: MAX_SIGNATURE_IMAGES }) : validated.signatureHtml

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
