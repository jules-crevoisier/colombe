/**
 * Connexion unique OIDC : variables AUTH_METHODS, OIDC_*, MAIL_SSO_AUTH, MAIL_OAUTH_MECHANISM,
 * MAIL_MASTER_*, COLOMBE_PORTAL_URL (server/lib/config, blocs « SSO (OIDC) »).
 */
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, masterLogin, publicConfig } from '../../../server/lib/config'

const base = { MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr' }
const oidc = {
  AUTH_METHODS: 'password,oidc',
  OIDC_ISSUER: 'https://idp.univ-exemple.fr/realms/univ',
  OIDC_CLIENT_ID: 'colombe',
  OIDC_CLIENT_SECRET: 'client-secret-value',
}
const master = { MAIL_SSO_AUTH: 'master', MAIL_MASTER_USER: 'colombe', MAIL_MASTER_PASSWORD: 'x'.repeat(24) }

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

describe('AUTH_METHODS', () => {
  it('défaut : mot de passe seul, pas d\'OIDC ni d\'accès SSO à la messagerie', () => {
    const c = loadConfig(base)
    expect(c.authMethods).toEqual(['password'])
    expect(c.oidc).toBeNull()
    expect(c.mailSso).toBeNull()
    expect(c.portalUrl).toBeNull()
  })

  it('refuse une méthode inconnue et une liste vide', () => {
    expect(problems({ ...base, AUTH_METHODS: 'password,cas' })).toHaveLength(1)
    expect(problems({ ...base, AUTH_METHODS: ' , ' })).toHaveLength(1)
  })

  it('oidc seul : pas de connexion par mot de passe', () => {
    const c = loadConfig({ ...base, ...oidc, AUTH_METHODS: 'oidc' })
    expect(c.authMethods).toEqual(['oidc'])
  })
})

describe('OIDC_*', () => {
  it('valeurs par défaut', () => {
    const c = loadConfig({ ...base, ...oidc })
    expect(c.oidc).toEqual({
      issuer: 'https://idp.univ-exemple.fr/realms/univ',
      clientId: 'colombe',
      clientSecret: 'client-secret-value',
      scopes: 'openid email profile offline_access',
      emailClaim: 'email',
      buttonLabel: 'Se connecter avec mon compte de l\'établissement',
      logout: true,
      redirectUrl: null,
    })
    // oauth2 par défaut, mécanisme XOAUTH2.
    expect(c.mailSso).toEqual({ mode: 'oauth2', mechanism: 'xoauth2' })
  })

  it('émetteur, identifiant et secret obligatoires ; tous les problèmes listés ensemble', () => {
    const list = problems({ ...base, AUTH_METHODS: 'oidc' })
    expect(list).toHaveLength(3)
    expect(list.join('\n')).toMatch(/OIDC_ISSUER/)
    expect(list.join('\n')).toMatch(/OIDC_CLIENT_ID/)
    expect(list.join('\n')).toMatch(/OIDC_CLIENT_SECRET/)
    expect(problems({ ...base, ...oidc, OIDC_CLIENT_SECRET: '' })).toEqual([expect.stringMatching(/OIDC_CLIENT_SECRET/)])
  })

  it('émetteur https obligatoire (http toléré en boucle locale seulement)', () => {
    expect(problems({ ...base, ...oidc, OIDC_ISSUER: 'http://idp.univ-exemple.fr' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, OIDC_ISSUER: 'pas une url' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, OIDC_ISSUER: 'https://idp.univ-exemple.fr/?x=1' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, OIDC_ISSUER: 'http://127.0.0.1:8080/realms/test' })).toEqual([])
    expect(problems({ ...base, ...oidc, OIDC_ISSUER: 'http://localhost:8080' })).toEqual([])
    // Barre finale retirée (comparaison exacte de `iss` par openid-client).
    expect(loadConfig({ ...base, ...oidc, OIDC_ISSUER: 'https://idp.univ-exemple.fr/' }).oidc?.issuer).toBe('https://idp.univ-exemple.fr')
  })

  it('portées : « openid » obligatoire ; revendication, libellé, déconnexion, URL de retour', () => {
    expect(problems({ ...base, ...oidc, OIDC_SCOPES: 'email profile' })).toHaveLength(1)
    const c = loadConfig({
      ...base,
      ...oidc,
      OIDC_SCOPES: 'openid, email',
      OIDC_EMAIL_CLAIM: 'preferred_username',
      OIDC_BUTTON_LABEL: 'Connexion ENT',
      OIDC_LOGOUT: 'false',
      OIDC_REDIRECT_URL: 'https://webmail.univ-exemple.fr/api/auth/oidc/callback',
    })
    expect(c.oidc).toMatchObject({ scopes: 'openid email', emailClaim: 'preferred_username', buttonLabel: 'Connexion ENT', logout: false, redirectUrl: 'https://webmail.univ-exemple.fr/api/auth/oidc/callback' })
    expect(problems({ ...base, ...oidc, OIDC_REDIRECT_URL: 'https://webmail.univ-exemple.fr/ailleurs' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, OIDC_REDIRECT_URL: 'javascript:alert(1)' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, OIDC_EMAIL_CLAIM: 'mail address' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, OIDC_LOGOUT: 'peut-être' })).toHaveLength(1)
  })

  it('incompatible avec la démo publique', () => {
    expect(problems({ MAIL_BACKEND: 'mock', COLOMBE_DEMO: 'true', ...oidc })).toEqual([expect.stringMatching(/COLOMBE_DEMO/)])
  })
})

describe('MAIL_SSO_AUTH / MAIL_OAUTH_MECHANISM', () => {
  it('oauth2 + oauthbearer', () => {
    expect(loadConfig({ ...base, ...oidc, MAIL_OAUTH_MECHANISM: 'OAUTHBEARER' }).mailSso).toEqual({ mode: 'oauth2', mechanism: 'oauthbearer' })
    expect(problems({ ...base, ...oidc, MAIL_OAUTH_MECHANISM: 'plain' })).toHaveLength(1)
    expect(problems({ ...base, ...oidc, MAIL_SSO_AUTH: 'kerberos' })).toHaveLength(1)
  })

  it('master : utilisateur, mot de passe >= 24 caractères, séparateur « * » par défaut', () => {
    const c = loadConfig({ ...base, ...oidc, ...master })
    expect(c.mailSso).toEqual({ mode: 'master', masterUser: 'colombe', masterPassword: 'x'.repeat(24), separator: '*' })
    expect(problems({ ...base, ...oidc, ...master, MAIL_MASTER_PASSWORD: 'x'.repeat(23) })).toEqual([expect.stringMatching(/24 caractères/)])
    expect(problems({ ...base, ...oidc, ...master, MAIL_MASTER_USER: '' })).toEqual([expect.stringMatching(/MAIL_MASTER_USER/)])
    expect(problems({ ...base, ...oidc, ...master, MAIL_MASTER_SEPARATOR: 'ab' })).toHaveLength(1)
    expect(loadConfig({ ...base, ...oidc, ...master, MAIL_MASTER_SEPARATOR: '%' }).mailSso).toMatchObject({ separator: '%' })
  })

  it('master interdit avec le backend mock ou la démo, et sans OIDC', () => {
    expect(problems({ MAIL_BACKEND: 'mock', ...oidc, ...master })).toEqual([expect.stringMatching(/mock ou la démo/)])
    expect(problems({ ...base, ...master })).toEqual([expect.stringMatching(/AUTH_METHODS=oidc/)])
  })

  it('identifiant IMAP d\'un utilisateur maître', () => {
    expect(masterLogin('jean.dupont@univ-exemple.fr', 'colombe', '*')).toBe('jean.dupont@univ-exemple.fr*colombe')
  })
})

describe('publicConfig (SSO)', () => {
  it('méthodes, libellé du bouton, portail ; jamais le secret ni le maître', () => {
    const c = loadConfig({ ...base, ...oidc, ...master, COLOMBE_PORTAL_URL: 'https://ent.univ-exemple.fr/' })
    const pub = publicConfig(c)
    expect(pub.login.methods).toEqual(['password', 'oidc'])
    expect(pub.login.oidc).toEqual({ label: 'Se connecter avec mon compte de l\'établissement' })
    expect(pub.portalUrl).toBe('https://ent.univ-exemple.fr/')
    const json = JSON.stringify(pub)
    expect(json).not.toContain('client-secret-value')
    expect(json).not.toContain('x'.repeat(24))
    expect(json).not.toContain('idp.univ-exemple.fr')
  })

  it('sans OIDC : oidc null, portail null', () => {
    const pub = publicConfig(loadConfig(base))
    expect(pub.login.methods).toEqual(['password'])
    expect(pub.login.oidc).toBeNull()
    expect(pub.portalUrl).toBeNull()
    expect(problems({ ...base, COLOMBE_PORTAL_URL: 'ftp://ent' })).toHaveLength(1)
  })
})
