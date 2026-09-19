import { getConfig } from '../config'

interface Clock {
  now: () => number
}

interface RateLimiterOptions {
  /** Nombre ou fonction (lue à chaque appel : limite venant de la configuration). */
  maxHits: number | (() => number)
  windowMs: number
  clock?: Clock
}

export class RateLimiter {
  private hits = new Map<string, number[]>() // key -> array of timestamps
  private readonly limit: () => number
  private readonly windowMs: number
  private readonly clock: Clock

  constructor(options: RateLimiterOptions) {
    const { maxHits } = options
    this.limit = typeof maxHits === 'function' ? maxHits : () => maxHits
    this.windowMs = options.windowMs
    this.clock = options.clock || { now: () => Date.now() }
  }

  private get maxHits(): number {
    return this.limit()
  }

  isLimited(key: string): boolean {
    const now = this.clock.now()
    const timestamps = this.hits.get(key) || []

    // Remove timestamps older than the window
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs)

    // Update the stored timestamps
    if (validTimestamps.length > 0) {
      this.hits.set(key, validTimestamps)
    } else {
      this.hits.delete(key)
    }

    return validTimestamps.length >= this.maxHits
  }

  hit(key: string): void {
    const now = this.clock.now()
    // Borne mémoire : une attaque sur des milliers d'adresses ne doit pas faire grossir la table indéfiniment.
    if (this.hits.size > 10_000) this.prune(now)
    const timestamps = this.hits.get(key) || []
    timestamps.push(now)
    this.hits.set(key, timestamps)
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  clear(): void {
    this.hits.clear()
  }

  private prune(now: number): void {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every(ts => now - ts >= this.windowMs)) this.hits.delete(key)
    }
  }
}

const FIFTEEN_MINUTES = 15 * 60 * 1000

/** Échecs de connexion par adresse : COLOMBE_LOGIN_LIMIT_ACCOUNT (défaut 5) / 15 min. */
export const loginLimiter = new RateLimiter({ maxHits: () => getConfig().limits.loginPerAccount, windowMs: FIFTEEN_MINUTES })

/**
 * Échecs de connexion par IP : COLOMBE_LOGIN_LIMIT_IP (défaut 30) / 15 min. Plus large
 * que par adresse car tout un établissement sort souvent par la même IP (NAT) : un
 * étudiant qui se trompe ne doit pas bloquer toute l'école, mais un robot de
 * credential stuffing reste freiné.
 */
export const ipLoginLimiter = new RateLimiter({ maxHits: () => getConfig().limits.loginPerIp, windowMs: FIFTEEN_MINUTES })

/** Envois par compte : COLOMBE_SEND_LIMIT (défaut 20) / 15 min, à aligner sur la limite Postfix. */
export const sendLimiter = new RateLimiter({ maxHits: () => getConfig().limits.sendPer15Min, windowMs: FIFTEEN_MINUTES })

/** Comptes démo créés par IP : 10 / 15 min (POST /api/auth/demo). Fixe, pas de compte à cranter. */
export const demoLimiter = new RateLimiter({ maxHits: 10, windowMs: FIFTEEN_MINUTES })

/** Recherches annuaire par session : 30 / min (GET /api/directory/search). */
export const directorySearchLimiter = new RateLimiter({ maxHits: 30, windowMs: 60_000 })
