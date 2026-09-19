import { describe, expect, it } from 'vitest'
import { buildAppleProfile, profileFilename, profileIdentifier, stableUuid } from '../../../server/lib/devices/mobileconfig'
import type { AppleProfileInput } from '../../../server/lib/devices/mobileconfig'

const input: AppleProfileInput = {
  email: 'jeanne.martin@univ-exemple.fr',
  username: 'jeanne.martin@univ-exemple.fr',
  imap: { host: 'mail.univ-exemple.fr', port: 993, security: 'ssl' },
  smtp: { host: 'smtp.univ-exemple.fr', port: 587, security: 'starttls' },
  productName: 'Colombe',
  orgName: 'Université Exemple',
}

/** Valeur qui suit <key>name</key> dans le plist (première occurrence à partir de `from`). */
function valueOf(xml: string, key: string, from = 0): string {
  const i = xml.indexOf(`<key>${key}</key>`, from)
  if (i < 0) throw new Error(`clé absente : ${key}`)
  const rest = xml.slice(i + key.length + 11).trimStart()
  const m = /^<(string|integer)>([^<]*)<\/\1>|^<(true|false)\/>/.exec(rest)
  if (!m) throw new Error(`valeur illisible : ${key}`)
  return m[2] ?? m[3]!
}

describe('profil Apple (mobileconfig)', () => {
  it('should describe an IMAP account with the public servers and the username', () => {
    const xml = buildAppleProfile(input)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(valueOf(xml, 'PayloadType')).toBe('com.apple.mail.managed')
    expect(valueOf(xml, 'EmailAccountType')).toBe('EmailTypeIMAP')
    expect(valueOf(xml, 'EmailAddress')).toBe('jeanne.martin@univ-exemple.fr')
    expect(valueOf(xml, 'IncomingMailServerHostName')).toBe('mail.univ-exemple.fr')
    expect(valueOf(xml, 'IncomingMailServerPortNumber')).toBe('993')
    expect(valueOf(xml, 'OutgoingMailServerHostName')).toBe('smtp.univ-exemple.fr')
    expect(valueOf(xml, 'OutgoingMailServerPortNumber')).toBe('587')
    expect(valueOf(xml, 'IncomingMailServerUsername')).toBe('jeanne.martin@univ-exemple.fr')
    expect(valueOf(xml, 'OutgoingMailServerUsername')).toBe('jeanne.martin@univ-exemple.fr')
    expect(valueOf(xml, 'IncomingMailServerAuthentication')).toBe('EmailAuthPassword')
    expect(valueOf(xml, 'OutgoingMailServerAuthentication')).toBe('EmailAuthPassword')
    // Profil englobant, après le tableau PayloadContent
    expect(valueOf(xml, 'PayloadType', xml.indexOf('</array>'))).toBe('Configuration')
    expect(valueOf(xml, 'PayloadOrganization')).toBe('Université Exemple')
  })

  it('should require encryption for both ssl and starttls servers', () => {
    const xml = buildAppleProfile(input)
    expect(valueOf(xml, 'IncomingMailServerUseSSL')).toBe('true')
    expect(valueOf(xml, 'OutgoingMailServerUseSSL')).toBe('true')
    const starttlsBoth = buildAppleProfile({ ...input, imap: { host: 'mail.univ-exemple.fr', port: 143, security: 'starttls' } })
    expect(valueOf(starttlsBoth, 'IncomingMailServerUseSSL')).toBe('true')
    expect(valueOf(starttlsBoth, 'IncomingMailServerPortNumber')).toBe('143')
  })

  it('should never contain a password', () => {
    const xml = buildAppleProfile(input)
    const passwordKeys = [...xml.matchAll(/<key>([^<]*Password[^<]*)<\/key>/gi)].map(m => m[1])
    // Seule clé « mot de passe » : l'indication d'utiliser le même pour l'envoi (booléen).
    expect(passwordKeys).toEqual(['OutgoingPasswordSameAsIncomingPassword'])
    expect(valueOf(xml, 'OutgoingPasswordSameAsIncomingPassword')).toBe('true')
  })

  it('should use the local part as username in localpart mode', () => {
    const xml = buildAppleProfile({ ...input, username: 'jeanne.martin' })
    expect(valueOf(xml, 'IncomingMailServerUsername')).toBe('jeanne.martin')
    expect(valueOf(xml, 'OutgoingMailServerUsername')).toBe('jeanne.martin')
    expect(valueOf(xml, 'EmailAddress')).toBe('jeanne.martin@univ-exemple.fr')
  })

  it('should escape every XML special character', () => {
    const nasty = 'a&b<c>"d\'@univ-exemple.fr'
    const xml = buildAppleProfile({ ...input, email: nasty, username: nasty, productName: 'Col<ombe> & "Co"', orgName: '' })
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;@univ-exemple.fr')
    expect(xml).not.toContain('a&b<c>')
    expect(xml).toContain('Col&lt;ombe&gt; &amp; &quot;Co&quot;')
    // Aucune balise inattendue : toutes les balises sont celles du plist.
    const tags = new Set([...xml.matchAll(/<\/?([A-Za-z!?][\w-]*)/g)].map(m => m[1]))
    expect([...tags].sort()).toEqual(['!DOCTYPE', '?xml', 'array', 'dict', 'false', 'integer', 'key', 'plist', 'string', 'true'].sort())
  })

  it('should derive stable, distinct UUIDs from the address', () => {
    const a = stableUuid('jeanne.martin@univ-exemple.fr', 'profile')
    expect(a).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)
    expect(stableUuid('Jeanne.Martin@univ-exemple.fr', 'profile')).toBe(a)
    expect(stableUuid('jeanne.martin@univ-exemple.fr', 'account')).not.toBe(a)
    expect(stableUuid('paul@univ-exemple.fr', 'profile')).not.toBe(a)
    const xml = buildAppleProfile(input)
    const uuids = [...xml.matchAll(/<key>PayloadUUID<\/key>\s*<string>([^<]+)<\/string>/g)].map(m => m[1])
    expect(uuids).toHaveLength(2)
    expect(new Set(uuids).size).toBe(2)
    expect(buildAppleProfile(input)).toBe(xml)
  })

  it('should use a reversed-domain payload identifier', () => {
    const id = profileIdentifier('jeanne.martin@univ-exemple.fr', 'Colombe')
    expect(id).toMatch(/^fr\.univ-exemple\.colombe\.mail\.[0-9a-f]{12}$/)
    expect(profileIdentifier('paul@univ-exemple.fr', 'Colombe')).not.toBe(id)
    expect(valueOf(buildAppleProfile(input), 'PayloadIdentifier', buildAppleProfile(input).indexOf('</array>'))).toBe(id)
  })

  it('should build a safe download filename from the product name', () => {
    expect(profileFilename('Colombe')).toBe('Colombe.mobileconfig')
    expect(profileFilename('Messagerie Élève')).toBe('Messagerie Eleve.mobileconfig')
    expect(profileFilename('a"b\\c/d;e\r\nf')).toBe('abcdef.mobileconfig')
    expect(profileFilename('"""')).toBe('Colombe.mobileconfig')
  })
})
