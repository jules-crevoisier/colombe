import { randomBytes } from 'node:crypto'
import type { MailCredentials } from '../mail/backend'

interface StoredCredentials extends MailCredentials {
  createdAt: number
  lastSeen: number
  hasBeenAccessed: boolean
}

interface Clock {
  now: () => number
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

  create(email: string, password: string): string {
    const sid = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    this.store.set(sid, {
      email,
      password,
      createdAt: now,
      lastSeen: now,
      hasBeenAccessed: false,
    })
    return sid
  }

  get(sid: string): MailCredentials | null {
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

    // Mark as accessed and update lastSeen
    creds.hasBeenAccessed = true
    creds.lastSeen = now

    return {
      email: creds.email,
      password: creds.password,
    }
  }

  delete(sid: string): void {
    this.store.delete(sid)
  }

  destroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval)
    }
  }
}

// Global singleton
export const credentialsStore = new CredentialsStore()
