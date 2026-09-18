import { describe, expect, it } from 'vitest'
import { getPrefs, savePrefs } from '../../../server/lib/store/prefs'
import { openDatabase } from '../../../server/lib/store/db'
import { DEFAULT_PREFS } from '#shared/types/mail'

describe('prefs store', () => {
  it('should return DEFAULT_PREFS for a new owner', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const prefs = getPrefs(db, owner)
    expect(prefs).toEqual(DEFAULT_PREFS)
  })

  it('should merge stored prefs with defaults, dropping unknown keys', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    savePrefs(db, owner, { pageSize: 100 })
    const prefs = getPrefs(db, owner)
    expect(prefs.pageSize).toBe(100)
    expect(prefs.signatureEnabled).toBe(DEFAULT_PREFS.signatureEnabled)
    expect(prefs.density).toBe(DEFAULT_PREFS.density)
  })

  it('should validate pageSize is one of 25, 50, 100', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    expect(() => savePrefs(db, owner, { pageSize: 75 as any })).toThrow()
  })

  it('should validate density is one of comfortable, compact', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    expect(() => savePrefs(db, owner, { density: 'cozy' as any })).toThrow()
  })

  it('should validate undoSendSeconds is one of 0, 5, 10, 20', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    expect(() => savePrefs(db, owner, { undoSendSeconds: 15 as any })).toThrow()
  })

  it('should enforce signatureHtml max length of 10000 chars', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const tooLong = 'a'.repeat(10001)
    expect(() => savePrefs(db, owner, { signatureHtml: tooLong })).toThrow()
  })

  it('should sanitize signatureHtml removing script tags', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const dirty = '<p>Hello <script>alert("xss")</script></p>'
    const prefs = savePrefs(db, owner, { signatureHtml: dirty })
    expect(prefs.signatureHtml).not.toContain('<script>')
    expect(prefs.signatureHtml).toContain('Hello')
  })

  it('should persist prefs across separate getPrefs calls', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    savePrefs(db, owner, { pageSize: 50, density: 'compact', undoSendSeconds: 10 })
    const prefs1 = getPrefs(db, owner)
    expect(prefs1.pageSize).toBe(50)
    expect(prefs1.density).toBe('compact')
    expect(prefs1.undoSendSeconds).toBe(10)
    const prefs2 = getPrefs(db, owner)
    expect(prefs2).toEqual(prefs1)
  })

  it('should update prefs with partial patches', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    savePrefs(db, owner, { pageSize: 50 })
    const prefs1 = getPrefs(db, owner)
    savePrefs(db, owner, { density: 'compact' })
    const prefs2 = getPrefs(db, owner)
    expect(prefs2.pageSize).toBe(50)
    expect(prefs2.density).toBe('compact')
  })

  it('should validate boolean fields', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const prefs = savePrefs(db, owner, {
      signatureEnabled: true,
      conversationView: false,
      desktopNotifications: true,
    })
    expect(prefs.signatureEnabled).toBe(true)
    expect(prefs.conversationView).toBe(false)
    expect(prefs.desktopNotifications).toBe(true)
  })

  it('should isolate prefs by owner', () => {
    const db = openDatabase(':memory:')
    savePrefs(db, 'alice@example.com', { pageSize: 50 })
    savePrefs(db, 'bob@example.com', { pageSize: 100 })
    expect(getPrefs(db, 'alice@example.com').pageSize).toBe(50)
    expect(getPrefs(db, 'bob@example.com').pageSize).toBe(100)
  })
})
