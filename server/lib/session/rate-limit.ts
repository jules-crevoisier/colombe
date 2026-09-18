interface Clock {
  now: () => number
}

interface RateLimiterOptions {
  maxHits: number
  windowMs: number
  clock?: Clock
}

export class RateLimiter {
  private hits = new Map<string, number[]>() // key -> array of timestamps
  private readonly maxHits: number
  private readonly windowMs: number
  private readonly clock: Clock

  constructor(options: RateLimiterOptions) {
    this.maxHits = options.maxHits
    this.windowMs = options.windowMs
    this.clock = options.clock || { now: () => Date.now() }
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

/** Échecs de connexion par adresse : 5 / 15 min. */
export const loginLimiter = new RateLimiter({ maxHits: 5, windowMs: FIFTEEN_MINUTES })

/**
 * Échecs de connexion par IP : 30 / 15 min. Plus large que par adresse car
 * tout l'IUT sort par la même IP (NAT) — un étudiant qui se trompe ne doit pas
 * bloquer toute l'école, mais un robot de credential stuffing reste freiné.
 */
export const ipLoginLimiter = new RateLimiter({ maxHits: 30, windowMs: FIFTEEN_MINUTES })

/** Envois par compte : 20 / 15 min, comme la limite Postfix. */
export const sendLimiter = new RateLimiter({ maxHits: 20, windowMs: FIFTEEN_MINUTES })
