import { createHash, randomBytes } from 'node:crypto'
import type { MailAuth, MailCredentials } from '../mail/backend'

// ─── SSO (OIDC) : début ───
/** Données d'une session ouverte par connexion unique (mémoire serveur, jamais dans le cookie). */
export interface SsoSessionData {
  /** Jeton d'identité, pour `id_token_hint` à la déconnexion. */
  idToken?: string
  /** Dernière réauthentification réussie chez le fournisseur (confirmation d'une action sensible). */
  reauthAt?: number
}

/** Nouveaux jetons après un rafraîchissement OIDC. */
export interface OAuthTokenUpdate {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  idToken?: string
}
// ─── SSO (OIDC) : fin ───

interface StoredCredentials extends MailCredentials {
  sso: SsoSessionData | null
  createdAt: number
  lastSeen: number
  hasBeenAccessed: boolean
  ip: string
  userAgent: string
}

interface Clock {
  now: () => number
}

/** Métadonnées d'une session, pour « Sessions actives » (R2.6). Jamais le sid en clair. */
export interface SessionInfo {
  sid: string
  email: string
  createdAt: number
  lastSeen: number
  ip: string
  userAgent: string
}

/** Empreinte de session exposée au client : jamais le sid réel (R2.6/R2.8). */
export function hashSessionId(sid: string): string {
  return createHash('sha256').update(sid).digest('hex').slice(0, 8)
}

export class CredentialsStore {
  private store = new Map<string, StoredCredentials>()
  private readonly ABSOLUTE_TTL = 8 * 60 * 60 * 1000 // 8 hours
  private readonly IDLE_TTL = 2 * 60 * 60 * 1000 // 2 hours
  private sweepInterval: NodeJS.Timeout | null = null

  constructor(private clock: Clock = { now: () => Date.now() }) {
    this.startSweep()
  }

  private startSweep(): void {
    this.sweepInterval = setInterval(
      () => {
        const now = this.clock.now()
        for (const [sid, creds] of this.store.entries()) {
          const age = now - creds.createdAt
          const idle = now - creds.lastSeen
          if (age > this.ABSOLUTE_TTL || idle > this.IDLE_TTL) {
            this.store.delete(sid)
          }
        }
      },
      60 * 1000 // Sweep every 60 seconds
    )
    // Unref the interval so it doesn't keep the process alive
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref()
    }
  }

  /** `auth` : une chaîne est acceptée comme mot de passe (session par mot de passe). */
  create(email: string, auth: MailAuth | string, ip = '', userAgent = '', sso: SsoSessionData | null = null): string {
    const sid = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    this.store.set(sid, {
      email,
      auth: typeof auth === 'string' ? { kind: 'password', password: auth } : auth,
      sso,
      createdAt: now,
      lastSeen: now,
      hasBeenAccessed: false,
      ip,
      // Même limite que le journal de connexion (login_events.user_agent).
      userAgent: userAgent.slice(0, 300),
    })
    return sid
  }

  /** Entrée vivante (non expirée) ou null ; efface une entrée expirée. */
  private live(sid: string): StoredCredentials | null {
    const creds = this.store.get(sid)
    if (!creds) return null

    const now = this.clock.now()
    const age = now - creds.createdAt
    const idle = now - creds.lastSeen

    // Check expiry
    // Absolute TTL always applies
    if (age > this.ABSOLUTE_TTL) {
      this.store.delete(sid)
      return null
    }

    // Idle TTL only applies if session has been accessed before
    if (creds.hasBeenAccessed && idle > this.IDLE_TTL) {
      this.store.delete(sid)
      return null
    }
    return creds
  }

  get(sid: string): MailCredentials | null {
    const creds = this.live(sid)
    if (!creds) return null

    // Mark as accessed and update lastSeen
    creds.hasBeenAccessed = true
    creds.lastSeen = this.clock.now()

    // Même objet `auth` que celui stocké : un rafraîchissement OIDC (updateOAuth) est vu
    // par les backends qui en gardent une référence (reconnexion IMAP, IDLE).
    return {
      email: creds.email,
      auth: creds.auth,
    }
  }

  // ─── SSO (OIDC) : début ───
  /** Données SSO de la session (null : session par mot de passe, ou sid inconnu/expiré). */
  getSso(sid: string): SsoSessionData | null {
    return this.live(sid)?.sso ?? null
  }

  /** Enregistre une réauthentification réussie. false si la session n'existe plus. */
  markReauth(sid: string, at: number = this.clock.now()): boolean {
    const creds = this.live(sid)
    if (!creds) return false
    creds.sso = { ...creds.sso, reauthAt: at }
    return true
  }

  /**
   * Remplace les jetons d'une session oauth2 EN PLACE (même objet `auth`) : les connexions
   * IMAP/SMTP/IDLE déjà créées se reconnectent ensuite avec le nouveau jeton.
   */
  updateOAuth(sid: string, update: OAuthTokenUpdate): boolean {
    const creds = this.live(sid)
    if (!creds || creds.auth.kind !== 'oauth2') return false
    creds.auth.accessToken = update.accessToken
    creds.auth.expiresAt = update.expiresAt
    if (update.refreshToken) creds.auth.refreshToken = update.refreshToken
    if (update.idToken) creds.sso = { ...creds.sso, idToken: update.idToken }
    return true
  }
  // ─── SSO (OIDC) : fin ───

  /** Sessions actives d'un utilisateur (celles déjà expirées sont exclues, sans les effacer ici). */
  listByOwner(email: string): SessionInfo[] {
    const now = this.clock.now()
    const out: SessionInfo[] = []
    for (const [sid, creds] of this.store.entries()) {
      if (creds.email !== email) continue
      const age = now - creds.createdAt
      const idle = now - creds.lastSeen
      if (age > this.ABSOLUTE_TTL) continue
      if (creds.hasBeenAccessed && idle > this.IDLE_TTL) continue
      out.push({ sid, email: creds.email, createdAt: creds.createdAt, lastSeen: creds.lastSeen, ip: creds.ip, userAgent: creds.userAgent })
    }
    return out
  }

  delete(sid: string): void {
    this.store.delete(sid)
  }

  /** Révoque toutes les sessions d'une adresse (éviction d'un compte démo). */
  revokeByOwner(email: string): void {
    for (const [sid, creds] of this.store.entries()) {
      if (creds.email === email) this.store.delete(sid)
    }
  }

  destroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval)
    }
  }
}

// Global singleton
export const credentialsStore = new CredentialsStore()
