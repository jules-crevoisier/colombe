import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../server/lib/config'
import { deviceSettings } from '../../../server/lib/devices/settings'
import { escapeXml, securityLabel } from '../../../server/lib/devices/xml'

const base = { MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr' }

describe('paramètres pour les autres logiciels', () => {
  it('should expose public servers, username and forward domains, never a password', () => {
    const s = deviceSettings('jeanne@univ-exemple.fr', loadConfig({ ...base, MAIL_FORWARD_DOMAINS: 'univ-exemple.fr,gmail.com' }))
    expect(s).toEqual({
      email: 'jeanne@univ-exemple.fr',
      username: 'jeanne@univ-exemple.fr',
      imap: { host: 'mail.univ-exemple.fr', port: 993, security: 'ssl' },
      smtp: { host: 'mail.univ-exemple.fr', port: 587, security: 'starttls' },
      forwardDomains: ['univ-exemple.fr', 'gmail.com'],
      productName: 'Colombe',
    })
    expect(JSON.stringify(s)).not.toMatch(/password/i)
  })

  it('should use the local part in localpart mode', () => {
    const s = deviceSettings('jeanne@univ-exemple.fr', loadConfig({ ...base, MAIL_LOGIN_USERNAME: 'localpart' }))
    expect(s.username).toBe('jeanne')
  })

  it('should return null servers when only a loopback host is configured', () => {
    const s = deviceSettings('dev@universite.example', loadConfig({ MAIL_BACKEND: 'mock' }))
    expect(s.imap).toBeNull()
    expect(s.smtp).toBeNull()
  })
})

describe('outils XML', () => {
  it('should escape the five XML special characters and drop control characters', () => {
    expect(escapeXml('a&b<c>"d\'e')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;e')
    expect(escapeXml('x\u0000y\u0007z')).toBe('xyz')
    expect(escapeXml(993)).toBe('993')
  })

  it('should label security modes as mail apps do', () => {
    expect(securityLabel('ssl')).toBe('SSL/TLS')
    expect(securityLabel('starttls')).toBe('STARTTLS')
  })
})
