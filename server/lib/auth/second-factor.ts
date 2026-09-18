import type { DatabaseSync } from 'node:sqlite'
import { markStepUsed, readSecret, useRecoveryCode } from '../store/twofactor'
import { verifyTotp } from './totp'

/** Clé de chiffrement des secrets 2FA (WEBMAIL_DATA_KEY, ≥ 32 caractères). */
export function dataKey(): string {
  const key = process.env.WEBMAIL_DATA_KEY ?? ''
  if (key.length < 32) throw new Error('WEBMAIL_DATA_KEY absente ou trop courte')
  return key
}

/**
 * Vérifie un second facteur : code TOTP à 6 chiffres (anti-rejeu) ou code de
 * secours (usage unique). `requireEnabled` = false pendant l'activation.
 */
export function verifySecondFactor(db: DatabaseSync, owner: string, code: string, opts: { requireEnabled: boolean; allowRecovery: boolean }): boolean {
  const stored = readSecret(db, owner, dataKey())
  if (!stored || (opts.requireEnabled && !stored.enabled)) return false
  const trimmed = code.trim()
  if (/^\d{3}\s?\d{3}$/.test(trimmed)) {
    const step = verifyTotp(stored.secret, trimmed, { lastStep: stored.lastStep })
    if (step === null) return false
    markStepUsed(db, owner, step)
    return true
  }
  return opts.allowRecovery && stored.enabled && useRecoveryCode(db, owner, trimmed)
}
