import { describe, it, expect, beforeEach } from 'vitest'
import { RateLimiter } from '../../../server/lib/session/rate-limit'

describe('RateLimiter', () => {
  let limiter: RateLimiter
  let clock: { now: () => number }

  beforeEach(() => {
    clock = { now: () => Date.now() }
    limiter = new RateLimiter({ maxHits: 5, windowMs: 15 * 60 * 1000, clock })
  })

  it('allows hits within the limit', () => {
    clock.now = () => 0
    for (let i = 0; i < 5; i++) {
      expect(limiter.isLimited('key')).toBe(false)
      limiter.hit('key')
    }
  })

  it('rejects after hitting the limit', () => {
    clock.now = () => 0
    for (let i = 0; i < 5; i++) {
      limiter.hit('key')
    }
    expect(limiter.isLimited('key')).toBe(true)
  })

  it('resets when window expires', () => {
    clock.now = () => 0
    for (let i = 0; i < 5; i++) {
      limiter.hit('key')
    }
    expect(limiter.isLimited('key')).toBe(true)

    // Move forward 15 minutes
    clock.now = () => 15 * 60 * 1000 + 1
    expect(limiter.isLimited('key')).toBe(false)
  })

  it('tracks multiple keys independently', () => {
    clock.now = () => 0
    for (let i = 0; i < 5; i++) {
      limiter.hit('key1')
    }
    expect(limiter.isLimited('key1')).toBe(true)
    expect(limiter.isLimited('key2')).toBe(false)

    limiter.hit('key2')
    expect(limiter.isLimited('key2')).toBe(false)
  })

  it('manually resets a key', () => {
    clock.now = () => 0
    for (let i = 0; i < 5; i++) {
      limiter.hit('key')
    }
    expect(limiter.isLimited('key')).toBe(true)

    limiter.reset('key')
    expect(limiter.isLimited('key')).toBe(false)
  })

  it('supports sliding window within 15 minutes', () => {
    clock.now = () => 0
    limiter.hit('key')
    limiter.hit('key')

    clock.now = () => 5 * 60 * 1000 // 5 min later
    limiter.hit('key')
    limiter.hit('key')
    limiter.hit('key')

    expect(limiter.isLimited('key')).toBe(true)

    clock.now = () => 6 * 60 * 1000 // 6 min total elapsed
    // First hit from t=0 has expired
    limiter.hit('key')
    expect(limiter.isLimited('key')).toBe(true)
  })
})
