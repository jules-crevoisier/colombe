import { describe, expect, it } from 'vitest'
import { consumePending, createPending, failPending, peekPending } from '../../../server/lib/auth/pending'
import { openDatabase } from '../../../server/lib/store/db'
import { disableTwoFactor, enableTwoFactor, isTwoFactorEnabled, markStepUsed, readSecret, storePendingSecret, twoFactorStatus, useRecoveryCode } from '../../../server/lib/store/twofactor'

const KEY = 'une-cle-de-donnees-de-test-suffisamment-longue'
const DEV = 'dev@universite.example'

describe('twofactor store', () => {
  it('should keep the secret encrypted and only enable after confirmation', () => {
    const db = openDatabase(':memory:')
    storePendingSecret(db, DEV, 'JBSWY3DPEHPK3PXP', KEY)
    const raw = db.prepare('SELECT secret_enc FROM totp').get() as { secret_enc: string }
    expect(raw.secret_enc).not.toContain('JBSWY3DPEHPK3PXP')
    expect(isTwoFactorEnabled(db, DEV)).toBe(false)
    expect(readSecret(db, DEV, KEY)).toEqual({ secret: 'JBSWY3DPEHPK3PXP', enabled: false, lastStep: 0 })
    const codes = enableTwoFactor(db, DEV)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    expect(twoFactorStatus(db, DEV)).toEqual({ enabled: true, recoveryCodesLeft: 10 })
    expect(() => storePendingSecret(db, DEV, 'AAAA', KEY)).toThrow()
  })

  it('should accept each recovery code once, whatever the case or separator, only for its owner', () => {
    const db = openDatabase(':memory:')
    storePendingSecret(db, DEV, 'JBSWY3DPEHPK3PXP', KEY)
    const code = enableTwoFactor(db, DEV)[0] ?? ''
    expect(useRecoveryCode(db, 'alice@universite.example', code)).toBe(false)
    expect(useRecoveryCode(db, DEV, code.toLowerCase().replace('-', ' '))).toBe(true)
    expect(useRecoveryCode(db, DEV, code)).toBe(false)
    expect(twoFactorStatus(db, DEV).recoveryCodesLeft).toBe(9)
  })

  it('should never lower last_step and should wipe everything on disable', () => {
    const db = openDatabase(':memory:')
    storePendingSecret(db, DEV, 'JBSWY3DPEHPK3PXP', KEY)
    markStepUsed(db, DEV, 100)
    markStepUsed(db, DEV, 90)
    expect(readSecret(db, DEV, KEY)?.lastStep).toBe(100)
    enableTwoFactor(db, DEV)
    disableTwoFactor(db, DEV)
    expect(twoFactorStatus(db, DEV)).toEqual({ enabled: false, recoveryCodesLeft: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM recovery_codes').get()).toEqual({ n: 0 })
  })
})

describe('pending logins', () => {
  it('should expire after 5 minutes and be single-use', () => {
    const id = createPending(DEV, 'pw', 0)
    expect(peekPending(id, 1000)).toEqual({ email: DEV })
    expect(peekPending(id, 5 * 60 * 1000 + 1)).toBeNull()
    const id2 = createPending(DEV, 'pw', 0)
    expect(consumePending(id2, 1000)).toEqual({ email: DEV, password: 'pw' })
    expect(consumePending(id2, 1000)).toBeNull()
  })

  it('should be invalidated after 5 wrong codes', () => {
    const id = createPending(DEV, 'pw')
    for (let i = 0; i < 4; i++) expect(failPending(id)).toBe(false)
    expect(failPending(id)).toBe(true)
    expect(peekPending(id)).toBeNull()
  })
})
