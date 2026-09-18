/**
 * Connexions en attente du second facteur : le mot de passe est vérifié mais
 * la session mail n'est pas encore ouverte. Mémoire serveur, 5 minutes,
 * 5 essais au plus.
 */
import { randomBytes } from 'node:crypto'

interface Pending {
  email: string
  password: string
  expiresAt: number
  attempts: number
}

const TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const pending = new Map<string, Pending>()

function sweep(now: number): void {
  for (const [id, p] of pending) if (p.expiresAt <= now) pending.delete(id)
}

export function createPending(email: string, password: string, now = Date.now()): string {
  sweep(now)
  const id = randomBytes(32).toString('base64url')
  pending.set(id, { email, password, expiresAt: now + TTL_MS, attempts: 0 })
  return id
}

export function peekPending(id: string, now = Date.now()): { email: string } | null {
  const p = pending.get(id)
  if (!p || p.expiresAt <= now) {
    pending.delete(id)
    return null
  }
  return { email: p.email }
}

/** Échec d'un code : true si la tentative en attente est désormais invalidée. */
export function failPending(id: string): boolean {
  const p = pending.get(id)
  if (!p) return true
  p.attempts += 1
  if (p.attempts >= MAX_ATTEMPTS) {
    pending.delete(id)
    return true
  }
  return false
}

/** Code valide : renvoie les identifiants et supprime l'attente (usage unique). */
export function consumePending(id: string, now = Date.now()): { email: string; password: string } | null {
  const p = pending.get(id)
  pending.delete(id)
  if (!p || p.expiresAt <= now) return null
  return { email: p.email, password: p.password }
}
