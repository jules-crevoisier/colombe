import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, generateSecret, hotp, otpauthUri, totpAt, verifyTotp } from '../../../server/lib/auth/totp'

// RFC 6238, annexe B (SHA-1, secret ASCII "12345678901234567890"), tronqué à 6 chiffres.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

describe('totp', () => {
  it('should match the RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    expected.forEach((code, counter) => expect(hotp(Buffer.from('12345678901234567890'), counter)).toBe(code))
  })

  it('should match the RFC 6238 TOTP vectors', () => {
    expect(totpAt(RFC_SECRET, 59)).toBe('287082')
    expect(totpAt(RFC_SECRET, 1111111109)).toBe('081804')
    expect(totpAt(RFC_SECRET, 1234567890)).toBe('005924')
    expect(totpAt(RFC_SECRET, 2000000000)).toBe('279037')
  })

  it('should round-trip base32 and generate 160-bit secrets', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(base32Decode(secret)).toHaveLength(20)
    expect(base32Encode(base32Decode(secret))).toBe(secret)
  })

  it('should accept the current code and ±1 step, reject older ones and replays', () => {
    const now = 1_800_000_000
    const step = Math.floor(now / 30)
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), { now, lastStep: 0 })).toBe(step)
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30), { now, lastStep: 0 })).toBe(step - 1)
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30), { now, lastStep: 0 })).toBe(step + 1)
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90), { now, lastStep: 0 })).toBeNull()
    // Un code déjà utilisé (même pas ou pas antérieur) est refusé.
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), { now, lastStep: step })).toBeNull()
    expect(verifyTotp(RFC_SECRET, 'abcdef', { now, lastStep: 0 })).toBeNull()
    expect(verifyTotp(RFC_SECRET, '12345', { now, lastStep: 0 })).toBeNull()
  })

  it('should build an otpauth URI with issuer and account', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'dev@mmi-troyes.fr')
    expect(uri).toBe('otpauth://totp/Colombe:dev%40mmi-troyes.fr?secret=JBSWY3DPEHPK3PXP&issuer=Colombe&algorithm=SHA1&digits=6&period=30')
  })
})
