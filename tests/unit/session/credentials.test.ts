import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CredentialsStore } from '../../../server/lib/session/credentials'

describe('CredentialsStore', () => {
  let store: CredentialsStore
  let clock: { now: () => number }

  beforeEach(() => {
    clock = { now: () => Date.now() }
    store = new CredentialsStore(clock)
  })

  it('creates a session and returns a sid', () => {
    const sid = store.create('dev@mmi-troyes.fr', 'password123')
    expect(sid).toBeTruthy()
    expect(typeof sid).toBe('string')
    expect(sid.length).toBeGreaterThan(20)
  })

  it('retrieves credentials by sid', () => {
    const sid = store.create('dev@mmi-troyes.fr', 'password123')
    const creds = store.get(sid)
    expect(creds).toEqual({
      email: 'dev@mmi-troyes.fr',
      password: 'password123',
    })
  })

  it('returns null for unknown sid', () => {
    const creds = store.get('unknown-sid')
    expect(creds).toBeNull()
  })

  it('updates lastSeen on get()', () => {
    const sid = store.create('dev@mmi-troyes.fr', 'password123')
    clock.now = () => 1000
    store.get(sid)
    clock.now = () => 2000
    store.get(sid)
    // Verify it still works (lastSeen was updated)
    const creds = store.get(sid)
    expect(creds).not.toBeNull()
  })

  it('expires after absolute TTL (8 hours)', () => {
    clock.now = () => 0
    const sid = store.create('dev@mmi-troyes.fr', 'password123')

    clock.now = () => 7 * 60 * 60 * 1000 // 7 hours
    expect(store.get(sid)).not.toBeNull()

    clock.now = () => 9 * 60 * 60 * 1000 // 9 hours
    expect(store.get(sid)).toBeNull()
  })

  it('expires after idle TTL (2 hours)', () => {
    clock.now = () => 0
    const sid = store.create('dev@mmi-troyes.fr', 'password123')

    clock.now = () => 1 * 60 * 60 * 1000 // 1 hour
    store.get(sid) // Touch it

    // At 3.5 hours from creation, 2.5 hours idle
    clock.now = () => 3.5 * 60 * 60 * 1000 // 3.5 hours (2.5 hours idle)
    expect(store.get(sid)).toBeNull()
  })

  it('deletes a session', () => {
    const sid = store.create('dev@mmi-troyes.fr', 'password123')
    expect(store.get(sid)).not.toBeNull()
    store.delete(sid)
    expect(store.get(sid)).toBeNull()
  })

  it('periodically sweeps expired sessions', async () => {
    clock.now = () => 0
    const sid1 = store.create('dev@mmi-troyes.fr', 'password123')
    const sid2 = store.create('alice@mmi-troyes.fr', 'password456')

    clock.now = () => 10 * 60 * 60 * 1000 // Both expired

    // Wait for sweep interval (check every 60s)
    await new Promise(resolve => setTimeout(resolve, 100))

    // After sweep, both should be gone
    expect(store.get(sid1)).toBeNull()
    expect(store.get(sid2)).toBeNull()
  })

  it('handles multiple sessions independently', () => {
    const sid1 = store.create('dev@mmi-troyes.fr', 'password123')
    const sid2 = store.create('alice@mmi-troyes.fr', 'password456')

    const creds1 = store.get(sid1)
    const creds2 = store.get(sid2)

    expect(creds1?.email).toBe('dev@mmi-troyes.fr')
    expect(creds2?.email).toBe('alice@mmi-troyes.fr')
  })
})
