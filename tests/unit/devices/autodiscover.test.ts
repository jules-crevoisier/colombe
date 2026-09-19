import { describe, expect, it } from 'vitest'
import { AUTODISCOVER_MAX_BODY, buildAutodiscover, extractAutodiscoverEmail } from '../../../server/lib/devices/autodiscover'

const DOMAINS = ['univ-exemple.fr']
const imap = { host: 'mail.univ-exemple.fr', port: 993, security: 'ssl' as const }
const smtp = { host: 'mail.univ-exemple.fr', port: 587, security: 'starttls' as const }

function request(address: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006">
  <Request>
    <EMailAddress>${address}</EMailAddress>
    <AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema>
  </Request>
</Autodiscover>`
}

function protocol(xml: string, type: 'IMAP' | 'SMTP'): string {
  const m = new RegExp(`<Protocol>\\s*<Type>${type}</Type>[\\s\\S]*?</Protocol>`).exec(xml)
  if (!m) throw new Error(`protocole absent : ${type}`)
  return m[0]
}

describe('autodiscover Outlook : adresse demandée', () => {
  it('should accept a valid address of an institution domain, lowercased', () => {
    expect(extractAutodiscoverEmail(request('Jeanne.Martin@Univ-Exemple.fr'), DOMAINS)).toBe('jeanne.martin@univ-exemple.fr')
    expect(extractAutodiscoverEmail(request(' o\'neil@univ-exemple.fr '), DOMAINS)).toBe('o\'neil@univ-exemple.fr')
  })

  it('should reject addresses outside the institution domains', () => {
    expect(extractAutodiscoverEmail(request('someone@gmail.com'), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail(request('someone@evil-univ-exemple.fr'), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail(request('someone@univ-exemple.fr.evil.com'), DOMAINS)).toBeNull()
  })

  it('should reject syntactically invalid addresses', () => {
    expect(extractAutodiscoverEmail(request('pas-une-adresse'), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail(request('a@@univ-exemple.fr'), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail(request('a..b@univ-exemple.fr'), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail(request('a&amp;b@univ-exemple.fr'), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail(request(`${'a'.repeat(65)}@univ-exemple.fr`), DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail('<EMailAddress>a<b>@univ-exemple.fr</EMailAddress>', DOMAINS)).toBeNull()
  })

  it('should ignore an empty, missing or oversized body', () => {
    expect(extractAutodiscoverEmail('', DOMAINS)).toBeNull()
    expect(extractAutodiscoverEmail('<Request></Request>', DOMAINS)).toBeNull()
    const padded = request('jeanne@univ-exemple.fr') + ' '.repeat(AUTODISCOVER_MAX_BODY)
    expect(extractAutodiscoverEmail(padded, DOMAINS)).toBeNull()
  })
})

describe('autodiscover Outlook : réponse', () => {
  it('should use the POX response schemas', () => {
    const xml = buildAutodiscover({ imap, smtp, loginName: null })
    expect(xml).toContain('<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">')
    expect(xml).toContain('<Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">')
    expect(xml).toContain('<AccountType>email</AccountType>')
    expect(xml).toContain('<Action>settings</Action>')
  })

  it('should map ssl to SSL on and starttls to Encryption TLS', () => {
    const xml = buildAutodiscover({ imap, smtp, loginName: 'jeanne@univ-exemple.fr' })
    const i = protocol(xml, 'IMAP')
    const s = protocol(xml, 'SMTP')
    expect(i).toContain('<Server>mail.univ-exemple.fr</Server>')
    expect(i).toContain('<Port>993</Port>')
    expect(i).toContain('<SSL>on</SSL>')
    expect(i).not.toContain('<Encryption>')
    expect(s).toContain('<Port>587</Port>')
    expect(s).toContain('<SSL>off</SSL>')
    expect(s).toContain('<Encryption>TLS</Encryption>')
  })

  it('should include the login name only when known, escaped', () => {
    expect(buildAutodiscover({ imap, smtp, loginName: null })).not.toContain('<LoginName>')
    const xml = buildAutodiscover({ imap, smtp, loginName: 'o\'neil&<x>' })
    expect(protocol(xml, 'IMAP')).toContain('<LoginName>o&apos;neil&amp;&lt;x&gt;</LoginName>')
    expect(protocol(xml, 'SMTP')).toContain('<LoginName>o&apos;neil&amp;&lt;x&gt;</LoginName>')
  })

  it('should never contain a password', () => {
    expect(buildAutodiscover({ imap, smtp, loginName: 'jeanne' })).not.toMatch(/password/i)
  })
})
