/**
 * TOTP (RFC 6238) / HOTP (RFC 4226), SHA-1, 6 chiffres, pas de 30 s — le
 * standard compris par toutes les applis d'authentification. Implémentation
 * sur node:crypto, sans dépendance.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP = 30
const DIGITS = 6
/** Tolérance de ±1 pas (décalage d'horloge du téléphone). */
const WINDOW = 1
const ISSUER = 'Webmail MMI'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char)
    if (idx === -1) throw new Error('Secret base32 invalide')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xFF)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Secret de 160 bits (recommandation RFC 4226), encodé en base32. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20))
}

export function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0F
  const binary = ((hmac[offset] ?? 0) & 0x7F) << 24
    | ((hmac[offset + 1] ?? 0) & 0xFF) << 16
    | ((hmac[offset + 2] ?? 0) & 0xFF) << 8
    | ((hmac[offset + 3] ?? 0) & 0xFF)
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** Code valable à l'instant `unixSeconds`. */
export function totpAt(secret: string, unixSeconds: number): string {
  return hotp(base32Decode(secret), Math.floor(unixSeconds / STEP))
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Vérifie un code. Renvoie le pas accepté (à mémoriser comme `lastStep`) ou null.
 * Un pas inférieur ou égal à `lastStep` est refusé : un code ne sert qu'une fois.
 */
export function verifyTotp(secret: string, code: string, opts: { now?: number; lastStep: number }): number | null {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return null
  const key = base32Decode(secret)
  const current = Math.floor((opts.now ?? Date.now() / 1000) / STEP)
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta
    if (step <= opts.lastStep) continue
    if (safeEqual(hotp(key, step), normalized)) return step
  }
  return null
}

export function otpauthUri(secret: string, account: string): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(account)}`
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`
}
