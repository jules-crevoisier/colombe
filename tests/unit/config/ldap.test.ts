import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, publicConfig } from '../../../server/lib/config'

const base = { MAIL_HOST: 'mail.univ-exemple.fr', MAIL_DOMAINS: 'univ-exemple.fr' }
const ldapBase = { ...base, LDAP_URL: 'ldaps://annuaire.univ-exemple.fr:636', LDAP_BASE_DN: 'dc=univ-exemple,dc=fr' }

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

describe('loadConfig : annuaire LDAP', () => {
  it('désactivé par défaut (LDAP_URL absent) : ldap === null, features.directory === false', () => {
    const c = loadConfig(base)
    expect(c.ldap).toBeNull()
    expect(publicConfig(c).features).toEqual({ directory: false })
  })

  it('activé : valeurs par défaut adaptées à SupAnn', () => {
    const c = loadConfig(ldapBase)
    expect(c.ldap).not.toBeNull()
    expect(c.ldap).toMatchObject({
      url: 'ldaps://annuaire.univ-exemple.fr:636',
      startTls: false,
      bindDn: null,
      bindPassword: null,
      baseDn: 'dc=univ-exemple,dc=fr',
      filter: '(&(objectClass=inetOrgPerson)(mail=*))',
      searchAttrs: ['cn', 'displayName', 'mail', 'sn', 'givenName', 'uid'],
      attrs: {
        name: 'displayName',
        nameFallback: 'cn',
        email: 'mail',
        phone: 'telephoneNumber',
        title: 'title',
        department: 'ou',
        affiliation: 'eduPersonPrimaryAffiliation',
      },
      maxResults: 20,
      minQuery: 3,
      timeoutMs: 5000,
      hideAffiliations: [],
    })
    expect(publicConfig(c).features).toEqual({ directory: true })
  })

  it('LDAP_BASE_DN obligatoire quand LDAP_URL est défini', () => {
    expect(problems({ ...base, LDAP_URL: 'ldaps://annuaire.univ-exemple.fr' })).toHaveLength(1)
    expect(problems(ldapBase)).toEqual([])
  })

  it('LDAP_URL invalide ou protocole non supporté', () => {
    expect(problems({ ...base, LDAP_URL: 'pas-une-url', LDAP_BASE_DN: 'dc=fr' })).toHaveLength(1)
    expect(problems({ ...base, LDAP_URL: 'https://annuaire.univ-exemple.fr', LDAP_BASE_DN: 'dc=fr' })).toHaveLength(1)
  })

  it('ldap:// non chiffré vers un hôte distant refusé sans LDAP_STARTTLS=true', () => {
    expect(problems({ ...base, LDAP_URL: 'ldap://annuaire.univ-exemple.fr', LDAP_BASE_DN: 'dc=fr' })).toHaveLength(1)
    expect(problems({ ...base, LDAP_URL: 'ldap://annuaire.univ-exemple.fr', LDAP_BASE_DN: 'dc=fr', LDAP_STARTTLS: 'true' })).toEqual([])
  })

  it('ldap:// vers un hôte local (développement) autorisé sans STARTTLS', () => {
    expect(problems({ ...base, LDAP_URL: 'ldap://localhost:389', LDAP_BASE_DN: 'dc=fr' })).toEqual([])
    expect(problems({ ...base, LDAP_URL: 'ldap://127.0.0.1:389', LDAP_BASE_DN: 'dc=fr' })).toEqual([])
    const c = loadConfig({ ...base, LDAP_URL: 'ldap://127.0.0.1:389', LDAP_BASE_DN: 'dc=fr' })
    expect(c.ldap?.startTls).toBe(false)
  })

  it('ldaps:// jamais concerné par la contrainte STARTTLS (TLS déjà natif)', () => {
    expect(problems({ ...base, LDAP_URL: 'ldaps://annuaire.univ-exemple.fr', LDAP_BASE_DN: 'dc=fr' })).toEqual([])
  })

  it('LDAP_BIND_DN et LDAP_BIND_PASSWORD : ensemble, ou aucun des deux (liaison anonyme)', () => {
    expect(problems({ ...ldapBase, LDAP_BIND_DN: 'cn=lecteur,dc=fr' })).toHaveLength(1)
    expect(problems({ ...ldapBase, LDAP_BIND_PASSWORD: 'secret' })).toHaveLength(1)
    const c = loadConfig({ ...ldapBase, LDAP_BIND_DN: 'cn=lecteur,dc=fr', LDAP_BIND_PASSWORD: 'secret' })
    expect(c.ldap).toMatchObject({ bindDn: 'cn=lecteur,dc=fr', bindPassword: 'secret' })
  })

  it('LDAP_FILTER personnalisé, doit être entre parenthèses', () => {
    const c = loadConfig({ ...ldapBase, LDAP_FILTER: '(&(objectClass=person)(mail=*))' })
    expect(c.ldap?.filter).toBe('(&(objectClass=person)(mail=*))')
    expect(problems({ ...ldapBase, LDAP_FILTER: 'objectClass=person' })).toHaveLength(1)
  })

  it('LDAP_SEARCH_ATTRS : liste séparée par virgules/espaces, casse conservée', () => {
    const c = loadConfig({ ...ldapBase, LDAP_SEARCH_ATTRS: 'cn, displayName , mail' })
    expect(c.ldap?.searchAttrs).toEqual(['cn', 'displayName', 'mail'])
  })

  it('attributs personnalisés (site SupAnn avec supannEntiteAffectation)', () => {
    const c = loadConfig({ ...ldapBase, LDAP_ATTR_DEPARTMENT: 'supannEntiteAffectation', LDAP_ATTR_NAME: 'cn' })
    expect(c.ldap?.attrs.department).toBe('supannEntiteAffectation')
    expect(c.ldap?.attrs.name).toBe('cn')
  })

  it('LDAP_MAX_RESULTS : défaut 20, bornes 1..100', () => {
    expect(loadConfig({ ...ldapBase, LDAP_MAX_RESULTS: '50' }).ldap?.maxResults).toBe(50)
    expect(problems({ ...ldapBase, LDAP_MAX_RESULTS: '0' })).toHaveLength(1)
    expect(problems({ ...ldapBase, LDAP_MAX_RESULTS: '101' })).toHaveLength(1)
  })

  it('LDAP_MIN_QUERY et LDAP_TIMEOUT_MS : défauts et validation', () => {
    expect(loadConfig({ ...ldapBase, LDAP_MIN_QUERY: '2' }).ldap?.minQuery).toBe(2)
    expect(loadConfig({ ...ldapBase, LDAP_TIMEOUT_MS: '10000' }).ldap?.timeoutMs).toBe(10_000)
    expect(problems({ ...ldapBase, LDAP_MIN_QUERY: 'abc' })).toHaveLength(1)
  })

  it('LDAP_HIDE_AFFILIATIONS : liste en minuscules', () => {
    const c = loadConfig({ ...ldapBase, LDAP_HIDE_AFFILIATIONS: 'Student, Alumni' })
    expect(c.ldap?.hideAffiliations).toEqual(['student', 'alumni'])
  })

  it('la configuration publique ne révèle ni base DN ni mot de passe de liaison', () => {
    const c = loadConfig({ ...ldapBase, LDAP_BIND_DN: 'cn=lecteur,dc=fr', LDAP_BIND_PASSWORD: 'un-secret-tres-prive' })
    const json = JSON.stringify(publicConfig(c))
    expect(json).not.toContain('un-secret-tres-prive')
    expect(json).not.toContain('dc=univ-exemple')
    expect(json).not.toContain('annuaire.univ-exemple.fr')
  })
})
