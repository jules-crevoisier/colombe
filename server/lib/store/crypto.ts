/**
 * Chiffrement des secrets au repos (secrets TOTP). AES-256-GCM, clé dérivée
 * par HKDF-SHA256 de WEBMAIL_DATA_KEY — distincte du mot de passe de session,
 * pour qu'une fuite de l'un ne compromette pas l'autre.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function key(secret: string): Buffer {
  if (secret.length < 32) throw new Error('WEBMAIL_DATA_KEY doit contenir au moins 32 caractères')
  return Buffer.from(hkdfSync('sha256', secret, 'webmail-mmi', 'totp-secret-v1', 32))
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function decryptSecret(token: string, secret: string): string {
  const [version, iv, tag, data] = token.split('.')
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Secret chiffré invalide')
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
