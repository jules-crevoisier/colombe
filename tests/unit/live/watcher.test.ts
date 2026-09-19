/**
 * Tests unitaires du gestionnaire de connexions IMAP IDLE.
 * Mock ImapFlow et timers pour tester la logique de refcount, grâce, reconnexion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImapFlow } from 'imapflow'
import type { MailCredentials, MailServerConfig } from '../../../server/lib/mail/backend'
import { InboxWatcher } from '../../../server/lib/live/watcher'
import { publishMailboxChange } from '../../../server/lib/live/bus'

vi.mock('../../../server/lib/live/bus', () => ({
  publishMailboxChange: vi.fn(),
}))

interface FakeImapFlow {
  connect: () => Promise<void>
  logout: () => Promise<void>
  close: () => void
  getMailboxLock: (path: string, opts: unknown) => Promise<{ release: () => void }>
  mailboxOpen: (path: string, opts: unknown) => Promise<{ path: string }>
  emit: (event: string, ...args: unknown[]) => boolean
  on: (event: string, handler: (...args: unknown[]) => void) => FakeImapFlow
  off: (event: string, handler: (...args: unknown[]) => void) => FakeImapFlow
  idle: () => Promise<void>
  usable: boolean
  listeners: Map<string, ((...args: unknown[]) => void)[]>
}

function createFakeClient(): FakeImapFlow {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const client: FakeImapFlow = {
    usable: true,
    listeners,
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    close: vi.fn(() => { client.usable = false }),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    mailboxOpen: vi.fn(async (path: string) => ({ path })),
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
      return true
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(handler)
      return this
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      const cbs = listeners.get(event)
      if (cbs) {
        const idx = cbs.indexOf(handler)
        if (idx !== -1) cbs.splice(idx, 1)
      }
      return this
    },
    idle: vi.fn(async () => {}),
  }
  return client
}

const testCreds: MailCredentials = { email: 'dev@universite.example', auth: { kind: 'password', password: 'dev-password' } }
const testConfig: MailServerConfig = {
  imapHost: '127.0.0.1',
  imapPort: 3143,
  imapSecure: false,
  imapServername: '127.0.0.1',
  smtpHost: '127.0.0.1',
  smtpPort: 3025,
  smtpSecure: false,
  smtpRequireTls: false,
  smtpServername: '127.0.0.1',
  loginUsername: 'email',
}

describe('InboxWatcher', () => {
  let fakeClock: ReturnType<typeof vi.useFakeTimers>

  beforeEach(() => {
    fakeClock = vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    fakeClock.useRealTimers()
  })

  it('should acquire and reference-count connections', async () => {
    let clientCount = 0
    const factory = () => {
      clientCount++
      return createFakeClient()
    }

    const watcher = new InboxWatcher({ clientFactory: factory, gracePeriodMs: 100 })

    // First acquire
    await watcher.acquire('sid1', testCreds, testConfig)
    expect(clientCount).toBe(1)

    // Second acquire with same sid reuses
    await watcher.acquire('sid1', testCreds, testConfig)
    expect(clientCount).toBe(1)

    // Different sid creates new
    await watcher.acquire('sid2', testCreds, testConfig)
    expect(clientCount).toBe(2)

    watcher.release('sid1')
    watcher.release('sid2')
  })

  it('should close connection after grace period on release', async () => {
    const client = createFakeClient()
    const factory = () => client

    const watcher = new InboxWatcher({ clientFactory: factory, gracePeriodMs: 100 })

    const sid = 'sid-grace-test'
    await watcher.acquire(sid, testCreds, testConfig)
    watcher.release(sid)

    // Connection still alive
    expect(client.usable).toBe(true)

    // Fast-forward through grace period
    fakeClock.advanceTimersByTime(100)
    await vi.runAllTimersAsync()

    // Now closed
    expect(client.logout).toHaveBeenCalled()
  })

  it('should enforce max watchers limit', async () => {
    const factory = () => createFakeClient()
    const watcher = new InboxWatcher({ clientFactory: factory, maxWatchers: 2, gracePeriodMs: 100 })

    await watcher.acquire('sid1', testCreds, testConfig)
    await watcher.acquire('sid2', testCreds, testConfig)

    // Third should fail
    await expect(watcher.acquire('sid3', testCreds, testConfig)).rejects.toThrow('Too many')

    watcher.release('sid1')
    watcher.release('sid2')
  })

  it('should publish mailbox changes with 500ms debounce', async () => {
    const client = createFakeClient()
    const factory = () => client

    const watcher = new InboxWatcher({ clientFactory: factory, gracePeriodMs: 100 })
    const sid = 'sid-debounce-test'
    await watcher.acquire(sid, testCreds, testConfig)

    // Trigger multiple events quickly
    const existsHandler = client.listeners.get('exists')![0]!
    existsHandler()
    existsHandler()
    existsHandler()

    // Nothing published yet (debounced)
    expect(publishMailboxChange).not.toHaveBeenCalled()

    // After debounce window
    fakeClock.advanceTimersByTime(500)
    await vi.runAllTimersAsync()

    expect(publishMailboxChange).toHaveBeenCalledWith('dev@universite.example', 'INBOX')
    expect(publishMailboxChange).toHaveBeenCalledTimes(1)

    watcher.release(sid)
  })

  it('should listen to exists, expunge, and flags events', async () => {
    const client = createFakeClient()
    const factory = () => client

    const watcher = new InboxWatcher({ clientFactory: factory, gracePeriodMs: 100 })
    const sid = 'sid-events-test'
    await watcher.acquire(sid, testCreds, testConfig)

    // All three should trigger the same handler (debounced)
    const existsHandler = client.listeners.get('exists')![0]!
    const expungeHandler = client.listeners.get('expunge')![0]!
    const flagsHandler = client.listeners.get('flags')![0]!

    // Trigger each event
    existsHandler()
    fakeClock.advanceTimersByTime(200)
    expungeHandler()
    fakeClock.advanceTimersByTime(200)
    flagsHandler()

    fakeClock.advanceTimersByTime(500)
    await vi.runAllTimersAsync()

    // Should publish once (last debounce window covers all)
    expect(publishMailboxChange).toHaveBeenCalledWith('dev@universite.example', 'INBOX')

    watcher.release(sid)
  })

  it('should handle auth errors without crashing', async () => {
    const client = createFakeClient()

    // Setup client to fail auth on connect
    const authError = new Error('authenticationFailed')
    ;(authError as unknown as { authenticationFailed?: boolean }).authenticationFailed = true
    client.connect = vi.fn(async () => {
      throw authError
    })

    const factory = () => client
    const watcher = new InboxWatcher({ clientFactory: factory, gracePeriodMs: 100 })

    const sid = 'sid-auth-error'
    // Should throw
    await expect(watcher.acquire(sid, testCreds, testConfig)).rejects.toThrow()

    watcher.release(sid)
  })

  it('should closeAll() on shutdown', async () => {
    const client1 = createFakeClient()
    const client2 = createFakeClient()
    const clients = [client1, client2]
    let callCount = 0
    const factory = () => clients[callCount++]!

    const watcher = new InboxWatcher({ clientFactory: factory, gracePeriodMs: 100 })

    await watcher.acquire('sid1', testCreds, testConfig)
    await watcher.acquire('sid2', testCreds, testConfig)

    await watcher.closeAll()

    expect(client1.logout).toHaveBeenCalled()
    expect(client2.logout).toHaveBeenCalled()
  })
})
