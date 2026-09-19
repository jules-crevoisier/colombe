import { describe, expect, it } from 'vitest'
import { buildAutoconfig } from '../../../server/lib/devices/autoconfig'
import type { AutoconfigInput } from '../../../server/lib/devices/autoconfig'

const input: AutoconfigInput = {
  domains: ['univ-exemple.fr', 'etu.univ-exemple.fr'],
  imap: { host: 'mail.univ-exemple.fr', port: 993, security: 'ssl' },
  smtp: { host: 'mail.univ-exemple.fr', port: 587, security: 'starttls' },
  username: 'email',
  productName: 'Colombe',
  orgName: '',
}

function block(xml: string, tag: 'incomingServer' | 'outgoingServer'): string {
  const m = new RegExp(`<${tag} type="(imap|smtp)">([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!m) throw new Error(`bloc absent : ${tag}`)
  return m[0]
}

describe('autoconfig Thunderbird', () => {
  it('should list every domain and use the first one as provider id', () => {
    const xml = buildAutoconfig(input)!
    expect(xml).toContain('<clientConfig version="1.1">')
    expect(xml).toContain('<emailProvider id="univ-exemple.fr">')
    expect(xml).toContain('<domain>univ-exemple.fr</domain>')
    expect(xml).toContain('<domain>etu.univ-exemple.fr</domain>')
  })

  it('should map ssl to SSL and starttls to STARTTLS', () => {
    const xml = buildAutoconfig(input)!
    const imap = block(xml, 'incomingServer')
    const smtp = block(xml, 'outgoingServer')
    expect(imap).toContain('type="imap"')
    expect(imap).toContain('<hostname>mail.univ-exemple.fr</hostname>')
    expect(imap).toContain('<port>993</port>')
    expect(imap).toContain('<socketType>SSL</socketType>')
    expect(smtp).toContain('type="smtp"')
    expect(smtp).toContain('<port>587</port>')
    expect(smtp).toContain('<socketType>STARTTLS</socketType>')
    expect(imap).toContain('<authentication>password-cleartext</authentication>')
    expect(smtp).toContain('<authentication>password-cleartext</authentication>')
  })

  it('should use %EMAILADDRESS% or %EMAILLOCALPART% depending on the username mode', () => {
    expect(block(buildAutoconfig(input)!, 'incomingServer')).toContain('<username>%EMAILADDRESS%</username>')
    const local = buildAutoconfig({ ...input, username: 'localpart' })!
    expect(block(local, 'incomingServer')).toContain('<username>%EMAILLOCALPART%</username>')
    expect(block(local, 'outgoingServer')).toContain('<username>%EMAILLOCALPART%</username>')
  })

  it('should escape XML special characters and contain no password', () => {
    const xml = buildAutoconfig({ ...input, productName: 'A&B <"x\'>', orgName: 'Faculté & co' })!
    expect(xml).toContain('<displayShortName>A&amp;B &lt;&quot;x&apos;&gt;</displayShortName>')
    expect(xml).toContain('Faculté &amp; co')
    expect(xml).not.toMatch(/<password/i)
  })

  it('should return null without any domain', () => {
    expect(buildAutoconfig({ ...input, domains: [] })).toBeNull()
  })
})
