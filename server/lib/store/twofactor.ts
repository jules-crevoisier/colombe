/**
 * Données 2FA par utilisateur : secret TOTP chiffré, dernier pas utilisé
 * (anti-rejeu), codes de secours hachés (usage unique).
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { TwoFactorStatus } from '#shared/types/mail'
import { decryptSecret, encryptSecret } from './crypto'

const RECOVERY_COUNT = 10
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

interface TotpRow {
  secret_enc: string
  enabled: number
  last_step: number
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex')
}

function row(db: DatabaseSync, owner: string): TotpRow | undefined {
  return db.prepare('SELECT secret_enc, enabled, last_step FROM totp WHERE owner = ?').get(owner) as TotpRow | undefined
}

export function twoFactorStatus(db: DatabaseSync, owner: string): TwoFactorStatus {
  const r = row(db, owner)
  const left = db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE owner = ? AND used_at IS NULL').get(owner) as { n: number }
  return { enabled: r?.enabled === 1, recoveryCodesLeft: r?.enabled === 1 ? left.n : 0 }
}

export function isTwoFactorEnabled(db: DatabaseSync, owner: string): boolean {
  return row(db, owner)?.enabled === 1
}

/** Enregistre un nouveau secret NON activé (en attente de confirmation par un code). */
export function storePendingSecret(db: DatabaseSync, owner: string, secret: string, key: string): void {
  if (isTwoFactorEnabled(db, owner)) throw new Error('La double authentification est déjà active')
  db.prepare(`INSERT INTO totp (owner, secret_enc, enabled, last_step, created_at) VALUES (?, ?, 0, 0, ?)
    ON CONFLICT(owner) DO UPDATE SET secret_enc = excluded.secret_enc, enabled = 0, last_step = 0, created_at = excluded.created_at`)
    .run(owner, encryptSecret(secret, key), new Date().toISOString())
}

export function readSecret(db: DatabaseSync, owner: string, key: string): { secret: string; enabled: boolean; lastStep: number } | null {
  const r = row(db, owner)
  return r ? { secret: decryptSecret(r.secret_enc, key), enabled: r.enabled === 1, lastStep: r.last_step } : null
}

export function markStepUsed(db: DatabaseSync, owner: string, step: number): void {
  db.prepare('UPDATE totp SET last_step = MAX(last_step, ?) WHERE owner = ?').run(step, owner)
}

/** Active la 2FA et renvoie les codes de secours EN CLAIR (affichés une seule fois). */
export function enableTwoFactor(db: DatabaseSync, owner: string): string[] {
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE totp SET enabled = 1 WHERE owner = ?').run(owner)
    const codes = replaceRecoveryCodes(db, owner)
    db.exec('COMMIT')
    return codes
  }
  catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function randomRecoveryCode(): string {
  // 10 caractères sans ambiguïté visuelle (pas de 0/O, 1/I) ≈ 50 bits.
  let raw = ''
  for (let i = 0; i < 10; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

export function replaceRecoveryCodes(db: DatabaseSync, owner: string): string[] {
  db.prepare('DELETE FROM recovery_codes WHERE owner = ?').run(owner)
  const insert = db.prepare('INSERT INTO recovery_codes (owner, code_hash) VALUES (?, ?)')
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const code = randomRecoveryCode()
    insert.run(owner, hashCode(code))
    return code
  })
}

/** Consomme un code de secours ; true s'il était valide et inutilisé. */
export function useRecoveryCode(db: DatabaseSync, owner: string, code: string): boolean {
  const wanted = Buffer.from(hashCode(code))
  const rows = db.prepare('SELECT id, code_hash FROM recovery_codes WHERE owner = ? AND used_at IS NULL').all(owner) as Array<{ id: number; code_hash: string }>
  const match = rows.find(r => timingSafeEqual(Buffer.from(r.code_hash), wanted))
  if (!match) return false
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(new Date().toISOString(), match.id)
  return true
}

export function disableTwoFactor(db: DatabaseSync, owner: string): void {
  db.prepare('DELETE FROM totp WHERE owner = ?').run(owner)
  db.prepare('DELETE FROM recovery_codes WHERE owner = ?').run(owner)
}
