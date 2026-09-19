import { beforeEach, describe, expect, it } from 'vitest'
import { DemoAccountManager, VISITOR_DISPLAY_NAME, expired, generateVisitorEmail, overflow } from '../../../server/lib/demo/accounts'
import { MockBackend, resetMockStore } from '../../../server/lib/mail/mock'
import { credentialsStore } from '../../../server/lib/session/credentials'
import { openDatabase, setDbForTests, useDb } from '../../../server/lib/store/db'
import { getPrefs } from '../../../server/lib/store/prefs'

const HOUR = 3_600_000

describe('expired (fonction pure)', () => {
  it('retient les comptes dont l\'âge dépasse ttlHours, sans horloge réelle', () => {
    const now = 1_000_000 * HOUR
    const records = [
      { email: 'a@x', createdAt: now - 5 * HOUR },
      { email: 'b@x', createdAt: now - 3 * HOUR },
      { email: 'c@x', createdAt: now },
    ]
    expect(expired(records, now, 4).map(r => r.email)).toEqual(['a@x'])
    expect(expired(records, now, 5).map(r => r.email)).toEqual(['a@x'])
    expect(expired(records, now, 6)).toEqual([])
  })
})

describe('overflow (fonction pure)', () => {
  it('rend vide sous la limite, sinon les plus anciens au-delà de maxAccounts', () => {
    const records = [
      { email: 'a@x', createdAt: 1 },
      { email: 'b@x', createdAt: 2 },
      { email: 'c@x', createdAt: 3 },
    ]
    expect(overflow(records, 3)).toEqual([])
    expect(overflow(records, 10)).toEqual([])
    expect(overflow(records, 2).map(r => r.email)).toEqual(['a@x'])
    expect(overflow(records, 1).map(r => r.email)).toEqual(['a@x', 'b@x'])
  })
})

describe('generateVisitorEmail', () => {
  it('forme visiteur-<8 hex>@<domaine>, distincte à chaque appel', () => {
    const email = generateVisitorEmail('universite.example')
    expect(email).toMatch(/^visiteur-[0-9a-f]{8}@universite\.example$/)
    expect(generateVisitorEmail('universite.example')).not.toBe(generateVisitorEmail('universite.example'))
  })
})

describe('DemoAccountManager', () => {
  beforeEach(() => {
    setDbForTests(openDatabase(':memory:'))
    resetMockStore()
  })

  it('create() seedé comme dev, prefs.welcomed déjà vrai, identité par défaut « Visiteur »', async () => {
    const manager = new DemoAccountManager()
    const email = manager.create('universite.example', 200)
    expect(manager.count()).toBe(1)
    expect(email).toMatch(/^visiteur-[0-9a-f]{8}@universite\.example$/)

    const backend = new MockBackend(email)
    const folders = await backend.listFolders()
    expect(folders.some(f => f.total > 0)).toBe(true)

    const prefs = getPrefs(useDb(), email)
    expect(prefs.welcomed).toBe(true)

    const identity = useDb().prepare('SELECT name, is_default FROM identities WHERE owner = ?').get(email) as { name: string; is_default: number } | undefined
    expect(identity).toMatchObject({ name: VISITOR_DISPLAY_NAME, is_default: 1 })
  })

  it('create() évince aussitôt le plus ancien compte au-delà de maxAccounts', () => {
    const manager = new DemoAccountManager()
    const first = manager.create('universite.example', 2)
    manager.create('universite.example', 2)
    expect(manager.count()).toBe(2)
    const third = manager.create('universite.example', 2)
    expect(manager.count()).toBe(2)

    // Le premier compte a été évincé : sa boîte n'existe plus.
    expect(useDb().prepare('SELECT owner FROM identities WHERE owner = ?').get(first)).toBeUndefined()
    expect(useDb().prepare('SELECT owner FROM identities WHERE owner = ?').get(third)).toBeDefined()
  })

  it('sweep() retire les comptes expirés (horloge injectée) : boîte, lignes SQLite et sessions', async () => {
    let now = 0
    const manager = new DemoAccountManager({ now: () => now })
    const email = manager.create('universite.example', 200)
    const sid = credentialsStore.create(email, 'unused-password')
    expect(credentialsStore.get(sid)).not.toBeNull()

    now = 3 * HOUR
    manager.sweep(4) // pas encore expiré (< 4 h)
    expect(manager.count()).toBe(1)

    now = 4 * HOUR
    manager.sweep(4) // âge = ttl : expiré (>=)
    expect(manager.count()).toBe(0)
    expect(credentialsStore.get(sid)).toBeNull()
    expect(useDb().prepare('SELECT owner FROM identities WHERE owner = ?').get(email)).toBeUndefined()
    await expect(new MockBackend(email).listFolders()).rejects.toThrow()
  })

  it('startSweep()/stopSweep() : le minuteur est unref() et peut être arrêté sans erreur', () => {
    const manager = new DemoAccountManager()
    manager.startSweep(4, 1000)
    manager.startSweep(4, 1000) // idempotent
    manager.stopSweep()
    manager.stopSweep() // idempotent
  })
})
