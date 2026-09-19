/**
 * Connexions en attente du second facteur : le mot de passe (ou la connexion unique
 * OIDC) est vérifié mais la session mail n'est pas encore ouverte. Mémoire serveur,
 * 5 minutes, 5 essais au plus.
 */
import { randomBytes } from 'node:crypto'
import type { MailAuth } from '../mail/backend'
import type { SsoSessionData } from '../session/credentials'

interface Pending {
  email: string
  auth: MailAuth
  /** Connexion unique OIDC : données reprises dans la session une fois le code validé. */
  sso: SsoSessionData | null
  expiresAt: number
  attempts: number
}

/** Ce que rend `consumePending` : de quoi ouvrir la session mail. */
export interface PendingCredentials {
  email: string
  auth: MailAuth
  sso: SsoSessionData | null
}

const TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const pending = new Map<string, Pending>()

function sweep(now: number): void {
  for (const [id, p] of pending) if (p.expiresAt <= now) pending.delete(id)
}

/** `auth` : une chaîne est acceptée comme mot de passe (connexion par mot de passe). */
export function createPending(email: string, auth: MailAuth | string, now = Date.now(), sso: SsoSessionData | null = null): string {
  sweep(now)
  const id = randomBytes(32).toString('base64url')
  pending.set(id, {
    email,
    auth: typeof auth === 'string' ? { kind: 'password', password: auth } : auth,
    sso,
    expiresAt: now + TTL_MS,
    attempts: 0,
  })
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
export function consumePending(id: string, now = Date.now()): PendingCredentials | null {
  const p = pending.get(id)
  pending.delete(id)
  if (!p || p.expiresAt <= now) return null
  return { email: p.email, auth: p.auth, sso: p.sso }
}
