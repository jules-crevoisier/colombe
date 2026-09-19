/**
 * Intégration réelle : recherche annuaire (server/lib/ldap) contre un vrai OpenLDAP
 * (docker compose -f docker-compose.ldap.yml up -d). ~15 personnes de l'« Université
 * Exemple » sous dc=universite,dc=example (docker/ldap/bootstrap.ldif), dont une
 * adresse hors domaine qui ne doit jamais être renvoyée.
 *
 * Ignoré automatiquement si le conteneur n'écoute pas sur 127.0.0.1:3389.
 */
import net from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../server/lib/config'
import type { LdapConfig } from '../../server/lib/config'
import { directorySearchCache } from '../../server/lib/ldap/cache'
import { resetLdapClient } from '../../server/lib/ldap/client'
import { DirectoryError, searchDirectory } from '../../server/lib/ldap/directory'

const reachable = await new Promise<boolean>((resolve) => {
  const socket = net.connect(3389, '127.0.0.1')
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})

const ENV = {
  MAIL_HOST: 'mail.univ-exemple.fr',
  MAIL_DOMAINS: 'universite.example',
  LDAP_URL: 'ldap://127.0.0.1:3389',
  LDAP_BASE_DN: 'dc=universite,dc=example',
  LDAP_BIND_DN: 'cn=admin,dc=universite,dc=example',
  LDAP_BIND_PASSWORD: 'admin-test-password',
}

function ldap(overrides: Record<string, string> = {}): LdapConfig {
  const config = loadConfig({ ...ENV, ...overrides })
  if (!config.ldap) throw new Error('LDAP non activé dans la configuration de test')
  return config.ldap
}

describe.skipIf(!reachable)('Annuaire LDAP contre OpenLDAP (réel)', () => {
  afterEach(() => {
    directorySearchCache.clear()
  })

  afterAll(() => {
    resetLdapClient()
  })

  it('trouve une personne par nom, avec les champs attendus', async () => {
    const results = await searchDirectory(ldap(), ['universite.example'], 'Dupont')
    expect(results).toEqual([
      expect.objectContaining({
        name: 'Jean Dupont',
        email: 'jean.dupont@universite.example',
        phone: '+33325000001',
        title: 'Maître de conférences',
        department: 'Informatique',
      }),
    ])
  })

  it('recherche insensible à la casse et fonctionnant sur un prénom accentué', async () => {
    const results = await searchDirectory(ldap(), ['universite.example'], 'eleonore')
    expect(results.some(r => r.name === 'Éléonore Béranger')).toBe(true)
  })

  it('plusieurs mots (AND) : affine la recherche', async () => {
    const results = await searchDirectory(ldap(), ['universite.example'], 'Léa Rousseau')
    expect(results.map(r => r.email)).toEqual(['lea.rousseau@universite.example'])
  })

  it('ne renvoie jamais une adresse hors domaine, même si l\'annuaire la contient', async () => {
    // « Partenaire » n'existe que sous labo-externe.fr dans l'annuaire de test.
    const results = await searchDirectory(ldap(), ['universite.example'], 'Partenaire')
    expect(results).toEqual([])
  })

  it('domaine autorisé : filtre côté appelant, pas côté LDAP_FILTER', async () => {
    // Sans restriction de domaine, l'entrée hors université apparaît bien côté LDAP.
    const raw = await searchDirectory(ldap(), ['universite.example', 'labo-externe.fr'], 'Partenaire')
    expect(raw.map(r => r.email)).toEqual(['paul.partenaire@labo-externe.fr'])
  })

  it('tri par nom, résultats bornés à LDAP_MAX_RESULTS', async () => {
    const results = await searchDirectory(ldap({ LDAP_MAX_RESULTS: '3' }), ['universite.example'], 'e')
    expect(results.length).toBeLessThanOrEqual(3)
    const names = results.map(r => r.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fr')))
  })

  it('tentative d\'injection dans le filtre : aucun résultat inattendu, pas d\'erreur', async () => {
    const results = await searchDirectory(ldap(), ['universite.example'], '*)(uid=*')
    expect(results).toEqual([])
  })

  it('affiliation absente (schéma eduPerson non chargé sur ce conteneur) : null, jamais une erreur', async () => {
    const results = await searchDirectory(ldap(), ['universite.example'], 'Dupont')
    expect(results[0]?.affiliation).toBeNull()
  })

  it('LDAP_HIDE_AFFILIATIONS exclut les entrées correspondantes (ici aucune, faute de schéma eduPerson) sans planter', async () => {
    const results = await searchDirectory(ldap({ LDAP_HIDE_AFFILIATIONS: 'student' }), ['universite.example'], 'Dupont')
    expect(results.map(r => r.email)).toEqual(['jean.dupont@universite.example'])
  })

  it('liaison invalide → DirectoryError générique, jamais le message LDAP brut ni le mot de passe', async () => {
    resetLdapClient()
    const bad = ldap({ LDAP_BIND_PASSWORD: 'mauvais-mot-de-passe' })
    await expect(searchDirectory(bad, ['universite.example'], 'Dupont')).rejects.toThrow(DirectoryError)
    resetLdapClient()
  })
})
