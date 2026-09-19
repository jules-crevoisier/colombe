import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/lib/store/db'
import { parseVCards } from '../../../server/lib/contacts/vcard'
import {
  applyContactImport,
  applyGroupImport,
  applyIdentityImport,
  applyResponseImport,
  textToHtml,
} from '../../../scripts/lib/roundcube.mjs'
import { importOneUser } from '../../../scripts/import-roundcube.mjs'

const OWNER = 'alice@example.org'

function buildRoundcubeFixture() {
  return {
    users: [{ user_id: '1', username: 'alice', mail_host: 'mail.example.org' }],
    contacts: [
      {
        contact_id: '10',
        user_id: '1',
        name: 'Bob Martin',
        email: 'bob@example.org',
        firstname: 'Bob',
        surname: 'Martin',
        vcard: 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Martin;Bob;;;\r\nFN:Bob Martin\r\nEMAIL;TYPE=WORK:bob@example.org\r\nTEL;TYPE=CELL:0600000000\r\nORG:ACME\r\nEND:VCARD\r\n',
        del: '0',
      },
      {
        contact_id: '11',
        user_id: '1',
        name: 'Carol Petit',
        email: 'carol@example.org',
        firstname: 'Carol',
        surname: 'Petit',
        vcard: '',
        del: '0',
      },
      {
        contact_id: '12',
        user_id: '1',
        name: 'Deleted Person',
        email: 'deleted@example.org',
        firstname: '',
        surname: '',
        vcard: '',
        del: '1',
      },
    ],
    contactgroups: [{ contactgroup_id: '5', user_id: '1', name: 'Amis', del: '0' }],
    contactgroupmembers: [
      { contactgroup_id: '5', contact_id: '10' },
      { contactgroup_id: '5', contact_id: '11' },
    ],
    identities: [
      {
        identity_id: '20',
        user_id: '1',
        standard: '1',
        name: 'Alice Dupont',
        organization: 'IUT',
        email: 'alice@example.org',
        reply_to: '',
        bcc: '',
        signature: 'Cordialement,\nAlice',
        html_signature: '0',
        del: '0',
      },
    ],
    responses: [
      { response_id: '30', user_id: '1', name: 'Bienvenue', data: '<p>Bonjour <b>!</b></p>', is_html: '1', del: '0' },
      { response_id: '31', user_id: '1', name: 'Supprimee', data: 'x', is_html: '0', del: '1' },
    ],
  }
}

describe('applyContactImport (unicité par adresse, insertion/fusion)', () => {
  it('creates a new contact', () => {
    const db = openDatabase(':memory:')
    const result = applyContactImport(db, OWNER, {
      firstName: 'Bob', lastName: 'Martin', displayName: 'Bob Martin',
      emails: [{ label: 'work', address: 'bob@example.org' }], phones: [], organization: '', jobTitle: '', birthday: null, notes: '',
    })
    expect(result.status).toBe('created')
    const row = db.prepare('SELECT email, name FROM contacts WHERE owner = ?').get(OWNER) as any
    expect(row.email).toBe('bob@example.org')
    expect(row.name).toBe('Bob Martin')
  })

  it('merges into an existing contact matched by a secondary address instead of duplicating', () => {
    const db = openDatabase(':memory:')
    applyContactImport(db, OWNER, {
      firstName: 'Bob', lastName: 'Martin', displayName: 'Bob Martin',
      emails: [{ label: 'work', address: 'bob@example.org' }, { label: 'home', address: 'bob.home@example.org' }],
      phones: [], organization: '', jobTitle: '', birthday: null, notes: '',
    })
    const second = applyContactImport(db, OWNER, {
      firstName: 'Bob', lastName: 'Martin', displayName: 'Bob Martin',
      emails: [{ label: 'home', address: 'bob.home@example.org' }],
      phones: [], organization: 'ACME', jobTitle: '', birthday: null, notes: '',
    })
    expect(second.status).toBe('merged')
    const count = (db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE owner = ?').get(OWNER) as any).n
    expect(count).toBe(1)
  })

  it('skips a record with no valid e-mail address', () => {
    const db = openDatabase(':memory:')
    const result = applyContactImport(db, OWNER, { firstName: 'X', lastName: '', displayName: '', emails: [], phones: [], organization: '', jobTitle: '', birthday: null, notes: '' })
    expect(result.status).toBe('skipped')
  })
})

describe('applyGroupImport / applyIdentityImport / applyResponseImport (idempotence owner+name)', () => {
  it('group: second call with the same name returns the same id, no duplicate row', () => {
    const db = openDatabase(':memory:')
    const first = applyGroupImport(db, OWNER, 'Amis')
    const second = applyGroupImport(db, OWNER, 'Amis')
    expect(second.status).toBe('exists')
    expect(second.id).toBe(first.id)
    const count = (db.prepare('SELECT COUNT(*) AS n FROM contact_groups WHERE owner = ?').get(OWNER) as any).n
    expect(count).toBe(1)
  })

  it('identity: converts a plain-text signature to HTML with <br>, first import becomes default', () => {
    const db = openDatabase(':memory:')
    const result = applyIdentityImport(db, OWNER, { name: 'Alice Dupont', replyTo: '', bcc: '', organization: 'IUT', signature: 'Ligne 1\nLigne 2', htmlSignature: false, email: OWNER, standard: true })
    expect(result.status).toBe('created')
    const row = db.prepare('SELECT signature_html, is_default FROM identities WHERE id = ?').get(result.id) as any
    expect(row.signature_html).toBe(textToHtml('Ligne 1\nLigne 2'))
    expect(row.is_default).toBe(1)
  })

  it('identity: re-importing the same owner+name updates instead of duplicating', () => {
    const db = openDatabase(':memory:')
    applyIdentityImport(db, OWNER, { name: 'Alice Dupont', replyTo: '', bcc: '', organization: '', signature: 'v1', htmlSignature: false, email: OWNER, standard: true })
    applyIdentityImport(db, OWNER, { name: 'Alice Dupont', replyTo: '', bcc: '', organization: 'IUT', signature: 'v2', htmlSignature: false, email: OWNER, standard: true })
    const count = (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE owner = ?').get(OWNER) as any).n
    expect(count).toBe(1)
    const row = db.prepare('SELECT organization FROM identities WHERE owner = ?').get(OWNER) as any
    expect(row.organization).toBe('IUT')
  })

  it('identity: strips <script> and event handlers from an HTML signature', () => {
    const db = openDatabase(':memory:')
    const result = applyIdentityImport(db, OWNER, {
      name: 'X', replyTo: '', bcc: '', organization: '', htmlSignature: true,
      signature: '<p onclick="evil()">Salut</p><script>alert(1)</script>',
      email: OWNER, standard: true,
    })
    const row = db.prepare('SELECT signature_html FROM identities WHERE id = ?').get(result.id) as any
    expect(row.signature_html).not.toContain('<script')
    expect(row.signature_html).not.toContain('onclick')
    expect(row.signature_html).toContain('Salut')
  })

  it('response: idempotent on owner+name, HTML kept for is_html', () => {
    const db = openDatabase(':memory:')
    const first = applyResponseImport(db, OWNER, { name: 'Bienvenue', data: '<p>Bonjour <b>!</b></p>', isHtml: true })
    const second = applyResponseImport(db, OWNER, { name: 'Bienvenue', data: '<p>Bonjour !</p>', isHtml: true })
    expect(first.status).toBe('created')
    expect(second.status).toBe('exists')
    const count = (db.prepare('SELECT COUNT(*) AS n FROM responses WHERE owner = ?').get(OWNER) as any).n
    expect(count).toBe(1)
  })
})

describe('importOneUser (import complet, pilote par les fonctions ci-dessus) + vCard', () => {
  it('imports contacts (with vCard parsing), a group with its members, an identity and a response', () => {
    const db = openDatabase(':memory:')
    const data = buildRoundcubeFixture()

    const stats = importOneUser(db, OWNER, '1', data, { parseVCards })

    expect(stats.contacts.created).toBe(2) // Bob (vCard) + Carol (repli name/email) ; "Deleted Person" ignoré (del=1)
    expect(stats.groups.created).toBe(1)
    expect(stats.groupMembers).toBe(2)
    expect(stats.identities.created).toBe(1)
    expect(stats.responses.created).toBe(1) // la réponse "Supprimee" (del=1) est ignorée

    const bob = db.prepare('SELECT name, details FROM contacts WHERE owner = ? AND email = ?').get(OWNER, 'bob@example.org') as any
    expect(bob).toBeTruthy()
    const bobDetails = JSON.parse(bob.details)
    expect(bobDetails.organization).toBe('ACME') // vient du vCard, pas de la colonne `name`
    expect(bobDetails.phones).toEqual([{ label: 'mobile', number: '0600000000' }])

    const carol = db.prepare('SELECT name FROM contacts WHERE owner = ? AND email = ?').get(OWNER, 'carol@example.org') as any
    expect(carol.name).toBe('Carol Petit')

    const deleted = db.prepare('SELECT 1 FROM contacts WHERE owner = ? AND email = ?').get(OWNER, 'deleted@example.org')
    expect(deleted).toBeUndefined()

    const group = db.prepare('SELECT id FROM contact_groups WHERE owner = ? AND name = ?').get(OWNER, 'Amis') as any
    const memberCount = (db.prepare('SELECT COUNT(*) AS n FROM contact_group_members WHERE group_id = ?').get(group.id) as any).n
    expect(memberCount).toBe(2)

    const identity = db.prepare('SELECT name, is_default FROM identities WHERE owner = ?').get(OWNER) as any
    expect(identity.name).toBe('Alice Dupont')
    expect(identity.is_default).toBe(1)

    const response = db.prepare('SELECT name, html FROM responses WHERE owner = ?').get(OWNER) as any
    expect(response.name).toBe('Bienvenue')
    expect(response.html).toContain('Bonjour')
  })

  it('is idempotent: running the same import twice does not duplicate anything', () => {
    const db = openDatabase(':memory:')
    const data = buildRoundcubeFixture()

    importOneUser(db, OWNER, '1', data, { parseVCards })
    const second = importOneUser(db, OWNER, '1', data, { parseVCards })

    expect(second.contacts.created).toBe(0)
    expect(second.contacts.merged).toBe(2)
    expect(second.groups.created).toBe(0)
    expect(second.groups.exists).toBe(1)
    expect(second.identities.created).toBe(0)
    expect(second.identities.updated).toBe(1)
    expect(second.responses.created).toBe(0)
    expect(second.responses.updated).toBe(1)

    const contactCount = (db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE owner = ?').get(OWNER) as any).n
    expect(contactCount).toBe(2)
    const groupCount = (db.prepare('SELECT COUNT(*) AS n FROM contact_groups WHERE owner = ?').get(OWNER) as any).n
    expect(groupCount).toBe(1)
    const identityCount = (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE owner = ?').get(OWNER) as any).n
    expect(identityCount).toBe(1)
    const responseCount = (db.prepare('SELECT COUNT(*) AS n FROM responses WHERE owner = ?').get(OWNER) as any).n
    expect(responseCount).toBe(1)
  })

  it('maps a Roundcube username without @ to an owner e-mail using --domain', () => {
    const db = openDatabase(':memory:')
    const data = buildRoundcubeFixture()
    const stats = importOneUser(db, 'alice@mmi-troyes.fr', '1', data, { parseVCards })
    expect(stats.contacts.created).toBe(2)
    const count = (db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE owner = ?').get('alice@mmi-troyes.fr') as any).n
    expect(count).toBe(2)
  })
})
