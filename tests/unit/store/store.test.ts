import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../../../server/lib/store/crypto'
import { openDatabase } from '../../../server/lib/store/db'

const KEY = 'une-cle-de-donnees-de-test-suffisamment-longue'

describe('store', () => {
  it('should create the schema and be re-openable (migrations idempotent)', () => {
    const db = openDatabase(':memory:')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['contacts', 'prefs', 'recovery_codes', 'schema_version', 'totp', 'identities', 'responses', 'contact_emails', 'contact_groups', 'contact_group_members', 'login_events']))
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 2 })
  })

  it('should round-trip an encrypted secret and reject tampering or a wrong key', () => {
    const token = encryptSecret('JBSWY3DPEHPK3PXP', KEY)
    expect(token).not.toContain('JBSWY3DPEHPK3PXP')
    expect(decryptSecret(token, KEY)).toBe('JBSWY3DPEHPK3PXP')
    expect(encryptSecret('JBSWY3DPEHPK3PXP', KEY)).not.toBe(token)
    expect(() => decryptSecret(token, `${KEY}-autre`)).toThrow()
    const parts = token.split('.')
    parts[3] = Buffer.from('falsifie').toString('base64')
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow()
  })

  it('should refuse a short key', () => {
    expect(() => encryptSecret('x', 'court')).toThrow(/32 caractères/)
  })
})
