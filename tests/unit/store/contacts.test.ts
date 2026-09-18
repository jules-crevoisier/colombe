import { describe, expect, it } from 'vitest'
import { listContacts, addContact, updateContact, deleteContact, recordRecipients } from '../../../server/lib/store/contacts'
import { openDatabase } from '../../../server/lib/store/db'
import type { ContactInput } from '#shared/types/mail'

describe('contacts store', () => {
  it('should return empty list for new owner', () => {
    const db = openDatabase(':memory:')
    const contacts = listContacts(db, 'alice@example.com')
    expect(contacts).toEqual([])
  })

  it('should add a manual contact', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const input: ContactInput = { email: 'bob@example.com', name: 'Bob' }
    const contact = addContact(db, owner, input)
    expect(contact.email).toBe('bob@example.com')
    expect(contact.name).toBe('Bob')
    expect(contact.manual).toBe(true)
    expect(contact.timesContacted).toBe(0)
  })

  it('should validate email address format', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    expect(() => addContact(db, owner, { email: 'invalid', name: 'Invalid' })).toThrow()
  })

  it('should enforce name max length of 200 chars', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const tooLong = 'a'.repeat(201)
    expect(() => addContact(db, owner, { email: 'bob@example.com', name: tooLong })).toThrow()
  })

  it('should upsert contact by email (case-insensitive)', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'bob@example.com', name: 'Bob v1' })
    const contact2 = addContact(db, owner, { email: 'BOB@EXAMPLE.COM', name: 'Bob v2' })
    expect(contact2.email).toBe('bob@example.com')
    expect(contact2.name).toBe('Bob v2')
    expect(contact2.manual).toBe(true)
    const list = listContacts(db, owner)
    expect(list).toHaveLength(1)
  })

  it('should search contacts by prefix of email', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'bob@example.com', name: 'Bob' })
    addContact(db, owner, { email: 'charlie@example.com', name: 'Charlie' })
    const results = listContacts(db, owner, { q: 'bo' })
    expect(results).toHaveLength(1)
    expect(results[0].email).toBe('bob@example.com')
  })

  it('should search by prefix of name', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'alice.martin@example.com', name: 'Alice Martin' })
    addContact(db, owner, { email: 'bob@example.com', name: 'Bob' })
    const results = listContacts(db, owner, { q: 'alice' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice Martin')
  })

  it('should search by prefix of any word in the name', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'alice.martin@example.com', name: 'Alice Martin' })
    const results = listContacts(db, owner, { q: 'mar' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice Martin')
  })

  it('should be case-insensitive in searches', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'bob@example.com', name: 'Bob Smith' })
    const results = listContacts(db, owner, { q: 'SMITH' })
    expect(results).toHaveLength(1)
  })

  it('should escape LIKE wildcards in search query', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'bob.special@example.com', name: 'Bob' })
    addContact(db, owner, { email: 'charlie@example.com', name: 'Charlie' })
    // Search for 'bob' should match the email prefix
    const results = listContacts(db, owner, { q: 'bob' })
    expect(results).toHaveLength(1)
  })

  it('should order by times_contacted DESC then last_contacted_at DESC', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const c1 = addContact(db, owner, { email: 'rarely@example.com', name: 'Rarely' })
    const c2 = addContact(db, owner, { email: 'often@example.com', name: 'Often' })
    recordRecipients(db, owner, [
      { email: 'often@example.com', name: 'Often' },
      { email: 'often@example.com' },
      { email: 'often@example.com' },
    ])
    const list = listContacts(db, owner)
    expect(list[0].email).toBe('often@example.com')
    expect(list[0].timesContacted).toBe(3)
  })

  it('should support limit parameter', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    for (let i = 0; i < 30; i++) {
      addContact(db, owner, { email: `user${i}@example.com`, name: `User ${i}` })
    }
    const page1 = listContacts(db, owner, { limit: 20 })
    expect(page1).toHaveLength(20)
  })

  it('should default limit to 20', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    for (let i = 0; i < 30; i++) {
      addContact(db, owner, { email: `user${i}@example.com`, name: `User ${i}` })
    }
    const list = listContacts(db, owner)
    expect(list).toHaveLength(20)
  })

  it('should update contact name', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const contact = addContact(db, owner, { email: 'bob@example.com', name: 'Bob' })
    const updated = updateContact(db, owner, contact.id, { name: 'Robert' })
    expect(updated.name).toBe('Robert')
    expect(updated.email).toBe('bob@example.com')
  })

  it('should return 404 when updating non-existent contact', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    expect(() => updateContact(db, owner, 999, { name: 'Test' })).toThrow('Contact not found')
  })

  it('should not allow updating another owner\'s contact', () => {
    const db = openDatabase(':memory:')
    const contact = addContact(db, 'alice@example.com', { email: 'bob@example.com', name: 'Bob' })
    expect(() => updateContact(db, 'eve@example.com', contact.id, { name: 'Hacked' })).toThrow('Contact not found')
  })

  it('should delete a contact', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const contact = addContact(db, owner, { email: 'bob@example.com', name: 'Bob' })
    deleteContact(db, owner, contact.id)
    const list = listContacts(db, owner)
    expect(list).toHaveLength(0)
  })

  it('should return 404 when deleting non-existent contact', () => {
    const db = openDatabase(':memory:')
    expect(() => deleteContact(db, 'alice@example.com', 999)).toThrow('Contact not found')
  })

  it('should not allow deleting another owner\'s contact', () => {
    const db = openDatabase(':memory:')
    const contact = addContact(db, 'alice@example.com', { email: 'bob@example.com', name: 'Bob' })
    expect(() => deleteContact(db, 'eve@example.com', contact.id)).toThrow('Contact not found')
  })

  it('should record recipients and increment times_contacted', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    recordRecipients(db, owner, [
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'charlie@example.com', name: 'Charlie' },
    ])
    const list = listContacts(db, owner)
    expect(list).toHaveLength(2)
    const bob = list.find(c => c.email === 'bob@example.com')
    expect(bob?.timesContacted).toBe(1)
    expect(bob?.manual).toBe(false)
  })

  it('should increment times_contacted on duplicate recipients in one call', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    recordRecipients(db, owner, [
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'bob@example.com' },
      { email: 'bob@example.com' },
    ])
    const list = listContacts(db, owner)
    expect(list).toHaveLength(1)
    expect(list[0].timesContacted).toBe(3)
  })

  it('should skip the owner\'s own email in recordRecipients', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    recordRecipients(db, owner, [
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
    ])
    const list = listContacts(db, owner)
    expect(list).toHaveLength(1)
    expect(list[0].email).toBe('bob@example.com')
  })

  it('should keep existing non-empty name when recording recipients', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    addContact(db, owner, { email: 'bob@example.com', name: 'Robert' })
    recordRecipients(db, owner, [{ email: 'bob@example.com', name: 'Bob' }])
    const list = listContacts(db, owner)
    expect(list[0].name).toBe('Robert')
  })

  it('should set name from recordRecipients if contact had empty name', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    const contact = addContact(db, owner, { email: 'bob@example.com', name: '' })
    recordRecipients(db, owner, [{ email: 'bob@example.com', name: 'Bob Smith' }])
    const list = listContacts(db, owner)
    expect(list[0].name).toBe('Bob Smith')
  })

  it('should update last_contacted_at on recordRecipients', () => {
    const db = openDatabase(':memory:')
    const owner = 'alice@example.com'
    recordRecipients(db, owner, [{ email: 'bob@example.com', name: 'Bob' }])
    const list = listContacts(db, owner)
    expect(list[0].lastContactedAt).toBeDefined()
    expect(list[0].lastContactedAt).not.toBeNull()
  })

  it('should isolate contacts by owner', () => {
    const db = openDatabase(':memory:')
    addContact(db, 'alice@example.com', { email: 'bob@example.com', name: 'Bob' })
    addContact(db, 'eve@example.com', { email: 'charlie@example.com', name: 'Charlie' })
    const alice_contacts = listContacts(db, 'alice@example.com')
    const eve_contacts = listContacts(db, 'eve@example.com')
    expect(alice_contacts).toHaveLength(1)
    expect(eve_contacts).toHaveLength(1)
    expect(alice_contacts[0].name).toBe('Bob')
    expect(eve_contacts[0].name).toBe('Charlie')
  })
})

describe('contacts — orchestrator review', () => {
  it('should keep history and id when a collected contact is added manually', async () => {
    const { openDatabase } = await import('../../../server/lib/store/db')
    const { addContact, listContacts, recordRecipients } = await import('../../../server/lib/store/contacts')
    const db = openDatabase(':memory:')
    recordRecipients(db, 'dev@mmi-troyes.fr', [{ email: 'lea.dubois@mmi-troyes.fr', name: 'Léa' }])
    recordRecipients(db, 'dev@mmi-troyes.fr', [{ email: 'lea.dubois@mmi-troyes.fr' }])
    const before = listContacts(db, 'dev@mmi-troyes.fr')[0]
    const added = addContact(db, 'dev@mmi-troyes.fr', { email: 'Lea.Dubois@mmi-troyes.fr', name: '' })
    expect(added).toMatchObject({ id: before?.id, manual: true, timesContacted: 2, name: 'Léa' })
  })

  it('should treat a backslash in the query literally', async () => {
    const { openDatabase } = await import('../../../server/lib/store/db')
    const { addContact, listContacts } = await import('../../../server/lib/store/contacts')
    const db = openDatabase(':memory:')
    addContact(db, 'dev@mmi-troyes.fr', { email: 'a@mmi-troyes.fr', name: 'A' })
    expect(listContacts(db, 'dev@mmi-troyes.fr', { q: String.fromCharCode(92) })).toEqual([])
  })
})
