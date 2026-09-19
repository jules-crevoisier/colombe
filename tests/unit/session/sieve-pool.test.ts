import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SieveError } from '../../../server/lib/sieve/client'
import type { SieveSessionLike } from '../../../server/lib/sieve/service'
import { SievePool } from '../../../server/lib/session/sieve-pool'

function fakeSession(overrides: Partial<SieveSessionLike> = {}): SieveSessionLike {
  return {
    capabilities: () => ['fileinto', 'vacation'],
    listScripts: vi.fn(async () => []),
    getScript: vi.fn(async () => ''),
    putScript: vi.fn(async () => undefined),
    checkScript: vi.fn(async () => undefined),
    setActive: vi.fn(async () => undefined),
    deleteScript: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('SievePool', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a connection once and reuses it across sequential calls', async () => {
    const pool = new SievePool()
    const session = fakeSession()
    const connect = vi.fn(async () => ({ available: true, session, capabilities: session.capabilities() }))

    const first = await pool.run('sid-1', connect, async (s) => s.listScripts())
    const second = await pool.run('sid-1', connect, async (s) => s.listScripts())

    expect(first).toEqual({ available: true, result: [] })
    expect(second).toEqual({ available: true, result: [] })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(session.listScripts).toHaveBeenCalledTimes(2)
  })

  it('opens separate connections for different sids', async () => {
    const pool = new SievePool()
    const connectA = vi.fn(async () => ({ available: true, session: fakeSession(), capabilities: [] }))
    const connectB = vi.fn(async () => ({ available: true, session: fakeSession(), capabilities: [] }))

    await pool.run('sid-a', connectA, async () => 'a')
    await pool.run('sid-b', connectB, async () => 'b')

    expect(connectA).toHaveBeenCalledTimes(1)
    expect(connectB).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable without throwing when connect() cannot reach the server', async () => {
    const pool = new SievePool()
    const connect = vi.fn(async () => ({ available: false, session: null, capabilities: [] }))

    const outcome = await pool.run('sid-1', connect, async () => 'never')

    expect(outcome).toEqual({ available: false })
  })

  it('serializes concurrent commands on the same connection (ManageSieve is one-at-a-time)', async () => {
    const pool = new SievePool()
    const session = fakeSession()
    const connect = vi.fn(async () => ({ available: true, session, capabilities: [] }))

    const order: string[] = []
    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const firstRun = pool.run('sid-1', connect, async () => {
      order.push('first-start')
      await firstGate
      order.push('first-end')
      return 1
    })
    // Lancé immédiatement après, sans attendre le premier : doit patienter derrière lui.
    const secondRun = pool.run('sid-1', connect, async () => {
      order.push('second-start')
      return 2
    })

    await vi.advanceTimersByTimeAsync(0) // laisse la micro-tâche du premier appel démarrer
    expect(order).toEqual(['first-start'])

    releaseFirst!()
    const [first, second] = await Promise.all([firstRun, secondRun])

    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
    expect(first).toEqual({ available: true, result: 1 })
    expect(second).toEqual({ available: true, result: 2 })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('drops the session and retries once with a fresh connection after a connection error', async () => {
    const pool = new SievePool()
    const dead = fakeSession()
    const fresh = fakeSession()
    let call = 0
    const connect = vi.fn(async () => {
      call += 1
      return { available: true, session: call === 1 ? dead : fresh, capabilities: [] }
    })

    let attempt = 0
    const outcome = await pool.run('sid-1', connect, async (session) => {
      attempt += 1
      if (session === dead) throw new SieveError('UNAVAILABLE', 'Connexion ManageSieve fermée')
      return 'ok'
    })

    expect(outcome).toEqual({ available: true, result: 'ok' })
    expect(attempt).toBe(2)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(dead.close).toHaveBeenCalledTimes(1)
  })

  it('does not retry on a non-connection error (e.g. an invalid script)', async () => {
    const pool = new SievePool()
    const session = fakeSession()
    const connect = vi.fn(async () => ({ available: true, session, capabilities: [] }))

    await expect(
      pool.run('sid-1', connect, async () => {
        throw new SieveError('INVALID', 'Script Sieve invalide')
      })
    ).rejects.toThrow('Script Sieve invalide')

    expect(connect).toHaveBeenCalledTimes(1)
    // La session reste poolée : une erreur applicative ne doit pas fermer une connexion saine.
    expect(session.close).not.toHaveBeenCalled()
  })

  it('closes the session after 60s of inactivity and reconnects on the next call', async () => {
    const pool = new SievePool()
    const first = fakeSession()
    const second = fakeSession()
    let call = 0
    const connect = vi.fn(async () => {
      call += 1
      return { available: true, session: call === 1 ? first : second, capabilities: [] }
    })

    await pool.run('sid-1', connect, async () => 'a')
    expect(connect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(first.close).toHaveBeenCalledTimes(1)

    await pool.run('sid-1', connect, async () => 'b')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('delete() closes the session immediately (logout / session revocation)', async () => {
    const pool = new SievePool()
    const session = fakeSession()
    const connect = vi.fn(async () => ({ available: true, session, capabilities: [] }))

    await pool.run('sid-1', connect, async () => 'a')
    await pool.delete('sid-1')

    expect(session.close).toHaveBeenCalledTimes(1)

    await pool.run('sid-1', connect, async () => 'b')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('caches script content per sid until invalidated', async () => {
    const pool = new SievePool()
    const session = fakeSession()
    const connect = vi.fn(async () => ({ available: true, session, capabilities: [] }))

    await pool.run('sid-1', connect, async () => undefined)
    expect(pool.getCachedScript('sid-1', 'colombe')).toBeUndefined()

    pool.setCachedScript('sid-1', 'colombe', 'require ["fileinto"];')
    expect(pool.getCachedScript('sid-1', 'colombe')).toBe('require ["fileinto"];')

    pool.invalidateScript('sid-1', 'colombe')
    expect(pool.getCachedScript('sid-1', 'colombe')).toBeUndefined()

    pool.setCachedScript('sid-1', 'colombe', 'require ["fileinto"];')
    pool.invalidateAllScripts('sid-1')
    expect(pool.getCachedScript('sid-1', 'colombe')).toBeUndefined()
  })

  it('has no script cache for a sid that was never pooled (mock backend never uses the pool)', () => {
    const pool = new SievePool()
    pool.setCachedScript('unknown-sid', 'colombe', 'ignored')
    expect(pool.getCachedScript('unknown-sid', 'colombe')).toBeUndefined()
  })
})
