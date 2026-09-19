import { describe, expect, it } from 'vitest'
import { ConfigError, authUsername, loadConfig, normalizeLoginEmail, publicConfig } from '../../../server/lib/config'

const base = { MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr' }
const secrets = {
  NODE_ENV: 'production',
  NUXT_SESSION_PASSWORD: 'session-password-at-least-32-characters!!',
  WEBMAIL_DATA_KEY: 'data-key-at-least-32-characters-long-xxxxx',
}

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env)
  }
  catch (err) {
    if (err instanceof ConfigError) return err.problems
    throw err
  }
  return []
}

describe('loadConfig', () => {
  it('minimal : hôte + domaine, valeurs par défaut sûres', () => {
    const c = loadConfig(base)
    expect(c.backend).toBe('imap')
    expect(c.imap).toMatchObject({ host: 'mail.univ-exemple.fr', port: 993, secure: true, servername: 'mail.univ-exemple.fr' })
    expect(c.smtp).toMatchObject({ host: 'mail.univ-exemple.fr', port: 587, secure: false, requireTls: true })
    expect(c.sieve).toMatchObject({ enabled: true, host: 'mail.univ-exemple.fr', port: 4190 })
    expect(c.tlsRejectUnauthorized).toBe(true)
    expect(c.login).toEqual({ domains: ['univ-exemple.fr'], defaultDomain: 'univ-exemple.fr', username: 'email' })
    expect(c.forwardDomains).toEqual(['univ-exemple.fr'])
    expect(c.trustProxy).toBe(false)
    expect(c.branding.productName).toBe('Colombe')
    expect(c.clients.imap).toEqual({ host: 'mail.univ-exemple.fr', port: 993, security: 'ssl' })
    expect(c.clients.smtp).toEqual({ host: 'mail.univ-exemple.fr', port: 587, security: 'starttls' })
  })

  it('backend imap : hôte et domaines obligatoires, tous les problèmes listés', () => {
    const p = problems({})
    expect(p.some(s => s.includes('MAIL_HOST'))).toBe(true)
    expect(p.some(s => s.includes('MAIL_DOMAINS'))).toBe(true)
  })

  it('backend mock : aucun serveur requis', () => {
    const c = loadConfig({ MAIL_BACKEND: 'mock' })
    expect(c.backend).toBe('mock')
    expect(c.login.domains).toEqual(['mmi-troyes.fr'])
  })

  it('alias historiques NUXT_MAIL_* et MAIL_ALLOWED_DOMAIN acceptés', () => {
    const c = loadConfig({ NUXT_MAIL_HOST: '127.0.0.1', NUXT_MAIL_IMAP_PORT: '3144', NUXT_MAIL_IMAP_SECURE: 'false', MAIL_ALLOWED_DOMAIN: 'a.fr', NUXT_MAIL_TRUST_PROXY: 'true' })
    expect(c.imap).toMatchObject({ host: '127.0.0.1', port: 3144, secure: false })
    expect(c.login.domains).toEqual(['a.fr'])
    expect(c.trustProxy).toBe(true)
  })

  it('hôtes séparés IMAP/SMTP et nom de certificat commun', () => {
    const c = loadConfig({ ...base, MAIL_IMAP_HOST: 'localhost', MAIL_SMTP_HOST: '127.0.0.1', MAIL_TLS_SERVERNAME: 'mail.univ-exemple.fr', MAIL_PUBLIC_HOST: 'mail.univ-exemple.fr' })
    expect(c.imap.servername).toBe('mail.univ-exemple.fr')
    expect(c.smtp.servername).toBe('mail.univ-exemple.fr')
    expect(c.sieve.servername).toBe('mail.univ-exemple.fr')
    expect(c.clients.imap?.host).toBe('mail.univ-exemple.fr')
  })

  it('hôte interne en boucle locale sans MAIL_PUBLIC_HOST : pas de paramètres publics inventés', () => {
    const c = loadConfig({ MAIL_HOST: 'localhost', MAIL_DOMAINS: 'u.fr' })
    expect(c.clients.imap).toBeNull()
    expect(c.clients.smtp).toBeNull()
  })

  it('ports publics différents : sécurité déduite du port', () => {
    const c = loadConfig({ ...base, MAIL_IMAP_PORT: '143', MAIL_PUBLIC_IMAP_PORT: '993', MAIL_PUBLIC_SMTP_PORT: '465' })
    expect(c.imap.secure).toBe(false)
    expect(c.clients.imap?.security).toBe('ssl')
    expect(c.clients.smtp?.security).toBe('ssl')
  })

  it('plusieurs domaines : pas de domaine par défaut implicite', () => {
    const c = loadConfig({ ...base, MAIL_DOMAINS: 'a.fr, b.fr' })
    expect(c.login.domains).toEqual(['a.fr', 'b.fr'])
    expect(c.login.defaultDomain).toBeNull()
    expect(loadConfig({ ...base, MAIL_DOMAINS: 'a.fr,b.fr', MAIL_LOGIN_DEFAULT_DOMAIN: 'b.fr' }).login.defaultDomain).toBe('b.fr')
    expect(loadConfig({ ...base, MAIL_LOGIN_DEFAULT_DOMAIN: 'none' }).login.defaultDomain).toBeNull()
    expect(problems({ ...base, MAIL_LOGIN_DEFAULT_DOMAIN: 'autre.fr' })).toHaveLength(1)
  })

  it('valeurs invalides rejetées', () => {
    expect(problems({ ...base, MAIL_IMAP_PORT: 'abc' })).toHaveLength(1)
    expect(problems({ ...base, MAIL_IMAP_SECURE: 'peut-être' })).toHaveLength(1)
    expect(problems({ ...base, MAIL_DOMAINS: 'pas un domaine' })).not.toHaveLength(0)
    expect(problems({ ...base, MAIL_LOGIN_USERNAME: 'uid' })).toHaveLength(1)
    expect(problems({ ...base, COLOMBE_SUPPORT_URL: 'javascript:alert(1)' })).toHaveLength(1)
    expect(problems({ ...base, COLOMBE_LOGO_FILE: 'nexiste-pas.svg' })).toHaveLength(1)
    expect(problems({ ...base, MAIL_BACKEND: 'pop' })).toHaveLength(1)
  })

  it('production : secrets obligatoires, distincts, TLS vérifié, pas de mock', () => {
    expect(problems({ ...base, ...secrets })).toEqual([])
    expect(problems({ ...base, NODE_ENV: 'production' })).toHaveLength(2)
    expect(problems({ ...base, ...secrets, WEBMAIL_DATA_KEY: secrets.NUXT_SESSION_PASSWORD })).toHaveLength(1)
    expect(problems({ ...base, ...secrets, MAIL_TLS_REJECT_UNAUTHORIZED: 'false' })).toHaveLength(1)
    expect(problems({ ...secrets, MAIL_BACKEND: 'mock' })).toHaveLength(1)
    expect(problems({ ...secrets, MAIL_BACKEND: 'mock', WEBMAIL_ALLOW_MOCK: '1' })).toEqual([])
  })
})

describe('normalizeLoginEmail', () => {
  const one = loadConfig(base)
  const multi = loadConfig({ ...base, MAIL_DOMAINS: 'a.fr,b.fr' })

  it('adresse complète du domaine, en minuscules', () => {
    expect(normalizeLoginEmail('  Jean.Dupont@Univ-Exemple.FR ', one)).toBe('jean.dupont@univ-exemple.fr')
  })
  it('identifiant seul : domaine par défaut ajouté', () => {
    expect(normalizeLoginEmail('jdupont', one)).toBe('jdupont@univ-exemple.fr')
    expect(normalizeLoginEmail('jdupont', multi)).toBeNull()
  })
  it('domaine étranger ou saisie invalide refusés', () => {
    expect(normalizeLoginEmail('x@gmail.com', one)).toBeNull()
    expect(normalizeLoginEmail('x@univ-exemple.fr.evil.com', one)).toBeNull()
    expect(normalizeLoginEmail('a b@univ-exemple.fr', one)).toBeNull()
    expect(normalizeLoginEmail('<x>@univ-exemple.fr', one)).toBeNull()
    expect(normalizeLoginEmail('', one)).toBeNull()
    expect(normalizeLoginEmail(`a${String.fromCharCode(0)}b@univ-exemple.fr`, one)).toBeNull()
    expect(normalizeLoginEmail('a\\b@univ-exemple.fr', one)).toBeNull()
    expect(normalizeLoginEmail('x@b.fr', multi)).toBe('x@b.fr')
  })
})

describe('authUsername / publicConfig', () => {
  it('localpart', () => {
    const c = loadConfig({ ...base, MAIL_LOGIN_USERNAME: 'localpart' })
    expect(authUsername('jean.dupont@univ-exemple.fr', c)).toBe('jean.dupont')
    expect(authUsername('jean.dupont@univ-exemple.fr', loadConfig(base))).toBe('jean.dupont@univ-exemple.fr')
  })
  it('la configuration publique ne révèle ni hôte ni secret', () => {
    const c = loadConfig({ ...base, ...secrets, COLOMBE_ORG_NAME: 'Université Exemple', MAIL_IMAP_HOST: 'imap.interne' })
    const json = JSON.stringify(publicConfig(c))
    expect(json).toContain('Université Exemple')
    expect(json).not.toContain('imap.interne')
    expect(json).not.toContain('mail.univ-exemple.fr')
    expect(json).not.toContain(secrets.WEBMAIL_DATA_KEY)
  })
})

describe('limites', () => {
  it('défauts et surcharge', () => {
    expect(loadConfig(base).limits).toEqual({ sendPer15Min: 20, loginPerAccount: 5, loginPerIp: 30, attachmentsBytes: 10 * 1024 * 1024 })
    const c = loadConfig({ ...base, COLOMBE_SEND_LIMIT: '50', COLOMBE_LOGIN_LIMIT_IP: '300', COLOMBE_MAX_ATTACHMENTS_MB: '25' })
    expect(c.limits).toMatchObject({ sendPer15Min: 50, loginPerIp: 300, attachmentsBytes: 25 * 1024 * 1024 })
    expect(publicConfig(c).limits).toEqual({ attachmentsBytes: 25 * 1024 * 1024 })
    expect(problems({ ...base, COLOMBE_SEND_LIMIT: '0' })).toHaveLength(1)
    expect(problems({ ...base, COLOMBE_MAX_ATTACHMENTS_MB: '1.5' })).toHaveLength(1)
  })
})
