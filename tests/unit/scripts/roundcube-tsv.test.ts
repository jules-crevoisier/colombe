import { describe, expect, it } from 'vitest'
import { parseTsvContent, parseTsvTable, unescapeTsvField, usernameToEmail } from '../../../scripts/lib/roundcube.mjs'

describe('unescapeTsvField', () => {
  it('turns the literal \\N marker into null', () => {
    expect(unescapeTsvField('\\N')).toBeNull()
  })

  it('unescapes \\t \\n \\r \\\\ ', () => {
    expect(unescapeTsvField('a\\tb')).toBe('a\tb')
    expect(unescapeTsvField('a\\nb')).toBe('a\nb')
    expect(unescapeTsvField('a\\rb')).toBe('a\rb')
    expect(unescapeTsvField('a\\\\b')).toBe('a\\b')
  })

  it('leaves plain text untouched', () => {
    expect(unescapeTsvField('bob@example.org')).toBe('bob@example.org')
  })
})

describe('parseTsvContent', () => {
  it('splits rows on newline and fields on tab, unescaping each field', () => {
    const content = '1\tbob@example.org\tBob\\tSmith\n2\t\\N\tCarol\n'
    const rows = parseTsvContent(content)
    expect(rows).toEqual([
      ['1', 'bob@example.org', 'Bob\tSmith'],
      ['2', null, 'Carol'],
    ])
  })

  it('ignores a trailing blank line and a leading BOM', () => {
    const rows = parseTsvContent('﻿1\ta\n2\tb\n\n')
    expect(rows).toEqual([['1', 'a'], ['2', 'b']])
  })

  it('handles CRLF line endings', () => {
    const rows = parseTsvContent('1\ta\r\n2\tb\r\n')
    expect(rows).toEqual([['1', 'a'], ['2', 'b']])
  })
})

describe('parseTsvTable', () => {
  it('maps positional fields to named columns', () => {
    const content = '1\tbob@example.org\tBob\n'
    const rows = parseTsvTable(content, ['contact_id', 'email', 'name'])
    expect(rows).toEqual([{ contact_id: '1', email: 'bob@example.org', name: 'Bob' }])
  })
})

describe('usernameToEmail', () => {
  it('returns the username unchanged when it already contains @', () => {
    expect(usernameToEmail('Bob@Example.ORG', undefined)).toBe('bob@example.org')
  })

  it('appends --domain when the username has no @', () => {
    expect(usernameToEmail('bob', 'example.org')).toBe('bob@example.org')
  })

  it('throws when there is no @ and no domain given', () => {
    expect(() => usernameToEmail('bob', undefined)).toThrow()
  })

  it('throws on an empty username', () => {
    expect(() => usernameToEmail('  ', 'example.org')).toThrow()
  })
})
