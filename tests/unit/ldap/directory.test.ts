import { describe, expect, it } from 'vitest'
import { buildDirectoryFilter, escapeFilterValue } from '../../../server/lib/ldap/escape'
import { affiliationLabel, firstAttrValue, isHiddenAffiliation, mapLdapEntry } from '../../../server/lib/ldap/mapping'
import type { LdapConfig } from '../../../server/lib/config'

// Octet de contrôle NUL référencé via String.fromCharCode(0) : jamais d'échappement
// littéral dans le code source (politique du dépôt, voir tests/unit/policy).
const NUL = String.fromCharCode(0)

describe('escapeFilterValue (RFC 4515)', () => {
  it('échappe les métacaractères de filtre', () => {
    expect(escapeFilterValue('*')).toBe('\\2a')
    expect(escapeFilterValue('(')).toBe('\\28')
    expect(escapeFilterValue(')')).toBe('\\29')
    expect(escapeFilterValue('\\')).toBe('\\5c')
    expect(escapeFilterValue(NUL)).toBe('\\00')
  })

  it('laisse les caractères accentués et espaces intacts (seuls les métacaractères sont échappés)', () => {
    expect(escapeFilterValue('Éléonore')).toBe('Éléonore')
    expect(escapeFilterValue('jean dupont')).toBe('jean dupont')
    expect(escapeFilterValue('o\'brien')).toBe('o\'brien')
  })

  it('vecteurs d\'injection classiques neutralisés', () => {
    expect(escapeFilterValue('*)(uid=*')).toBe('\\2a\\29\\28uid=\\2a')
    expect(escapeFilterValue('admin)(|(uid=*')).toBe('admin\\29\\28|\\28uid=\\2a')
    expect(escapeFilterValue(`a${NUL}b`)).toBe('a\\00b')
    expect(escapeFilterValue('\\*()')).toBe('\\5c\\2a\\28\\29')
  })
})

describe('buildDirectoryFilter', () => {
  const attrs = ['cn', 'mail']
  const base = '(&(objectClass=inetOrgPerson)(mail=*))'

  it('un mot : OR sur les attributs, ET avec le filtre de base', () => {
    expect(buildDirectoryFilter('jean', attrs, base)).toBe('(&(&(objectClass=inetOrgPerson)(mail=*))(|(cn=*jean*)(mail=*jean*)))')
  })

  it('plusieurs mots : ET entre les blocs OR', () => {
    const filter = buildDirectoryFilter('jean dupont', attrs, base)
    expect(filter).toBe('(&(&(objectClass=inetOrgPerson)(mail=*))(|(cn=*jean*)(mail=*jean*))(|(cn=*dupont*)(mail=*dupont*)))')
  })

  it('espaces superflus ignorés', () => {
    expect(buildDirectoryFilter('  jean   dupont  ', attrs, base)).toBe(buildDirectoryFilter('jean dupont', attrs, base))
  })

  it('un terme d\'injection reste entre les astérisques échappés, jamais interprété comme une clause', () => {
    const filter = buildDirectoryFilter('*)(uid=*', attrs, base)
    expect(filter).toBe('(&(&(objectClass=inetOrgPerson)(mail=*))(|(cn=*\\2a\\29\\28uid=\\2a*)(mail=*\\2a\\29\\28uid=\\2a*)))')
    // Parenthèses équilibrées : aucune clause supplémentaire n'a été injectée.
    expect((filter.match(/\(/g) ?? []).length).toBe((filter.match(/\)/g) ?? []).length)
  })
})

describe('affiliationLabel', () => {
  it('valeurs eduPerson connues → libellés français', () => {
    expect(affiliationLabel('student')).toBe('Étudiant')
    expect(affiliationLabel('staff')).toBe('Personnel')
    expect(affiliationLabel('faculty')).toBe('Enseignant')
    expect(affiliationLabel('employee')).toBe('Personnel')
    expect(affiliationLabel('STUDENT')).toBe('Étudiant')
  })

  it('valeur multi-token (premier segment) ou inconnue : passage tel quel', () => {
    expect(affiliationLabel('student;member')).toBe('Étudiant')
    expect(affiliationLabel('affiliate')).toBe('affiliate')
  })

  it('valeur absente : null', () => {
    expect(affiliationLabel(null)).toBeNull()
  })
})

describe('isHiddenAffiliation (LDAP_HIDE_AFFILIATIONS)', () => {
  it('liste vide : jamais masqué', () => {
    expect(isHiddenAffiliation('student', [])).toBe(false)
  })

  it('valeur masquée, insensible à la casse', () => {
    expect(isHiddenAffiliation('student', ['student'])).toBe(true)
    expect(isHiddenAffiliation('STUDENT', ['student'])).toBe(true)
    expect(isHiddenAffiliation('staff', ['student'])).toBe(false)
  })

  it('valeur absente : jamais masqué', () => {
    expect(isHiddenAffiliation(null, ['student'])).toBe(false)
  })

  it('premier token d\'une valeur multiple', () => {
    expect(isHiddenAffiliation('student;member', ['student'])).toBe(true)
    expect(isHiddenAffiliation('member;student', ['student'])).toBe(false)
  })
})

describe('firstAttrValue', () => {
  it('chaîne, tableau, Buffer, absent', () => {
    expect(firstAttrValue('a')).toBe('a')
    expect(firstAttrValue(['a', 'b'])).toBe('a')
    expect(firstAttrValue(Buffer.from('a'))).toBe('a')
    expect(firstAttrValue(undefined)).toBeNull()
    expect(firstAttrValue('  ')).toBeNull()
  })
})

describe('mapLdapEntry', () => {
  const attrs: LdapConfig['attrs'] = {
    name: 'displayName',
    nameFallback: 'cn',
    email: 'mail',
    phone: 'telephoneNumber',
    title: 'title',
    department: 'ou',
    affiliation: 'eduPersonPrimaryAffiliation',
  }

  it('fiche complète', () => {
    expect(mapLdapEntry({
      displayName: 'Jean Dupont',
      cn: 'jdupont',
      mail: 'Jean.Dupont@Univ-Exemple.FR',
      telephoneNumber: '0123456789',
      title: 'Maître de conférences',
      ou: 'Informatique',
      eduPersonPrimaryAffiliation: 'faculty',
    }, attrs)).toEqual({
      name: 'Jean Dupont',
      email: 'jean.dupont@univ-exemple.fr',
      phone: '0123456789',
      title: 'Maître de conférences',
      department: 'Informatique',
      affiliation: 'Enseignant',
    })
  })

  it('sans displayName : repli sur cn', () => {
    const entry = mapLdapEntry({ cn: 'Marie Curie', mail: 'marie.curie@univ-exemple.fr' }, attrs)
    expect(entry?.name).toBe('Marie Curie')
  })

  it('sans mail : entrée exclue (null)', () => {
    expect(mapLdapEntry({ cn: 'Sans Adresse' }, attrs)).toBeNull()
  })

  it('champs optionnels absents : null (jamais undefined ni chaîne vide)', () => {
    const entry = mapLdapEntry({ mail: 'x@univ-exemple.fr' }, attrs)
    expect(entry).toEqual({ name: 'x@univ-exemple.fr', email: 'x@univ-exemple.fr', phone: null, title: null, department: null, affiliation: null })
  })
})
