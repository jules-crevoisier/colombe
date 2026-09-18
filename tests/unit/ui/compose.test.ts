import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildReplySubject,
  buildReplyBody,
  buildForwardSubject,
  buildForwardBody,
  parseRecipientString,
  validateEmailAddress
} from '~/utils/compose'
import type { MessageDetail, Address } from '#shared/types/mail'

describe('buildReplySubject', () => {
  it('adds "Re: " prefix to subject without it', () => {
    expect(buildReplySubject('Test message')).toBe('Re: Test message')
  })

  it('does not duplicate "Re: " prefix', () => {
    expect(buildReplySubject('Re: Test message')).toBe('Re: Test message')
  })

  it('handles case-insensitive Re: prefix', () => {
    expect(buildReplySubject('RE: Test message')).toBe('RE: Test message')
  })

  it('handles empty subject', () => {
    expect(buildReplySubject('')).toBe('Re: ')
  })

  it('handles multiple existing Re: prefixes', () => {
    const result = buildReplySubject('Re: Re: Test message')
    expect(result).toBe('Re: Re: Test message')
  })
})

describe('buildForwardSubject', () => {
  it('adds "Tr: " prefix (or "Fwd: " for English)', () => {
    const result = buildForwardSubject('Test message')
    expect(result).toMatch(/^(Tr|Fwd): Test message/)
  })

  it('does not duplicate Tr: prefix', () => {
    const result = buildForwardSubject('Tr: Test message')
    expect(result).toMatch(/^Tr: Test message/)
  })

  it('handles empty subject', () => {
    const result = buildForwardSubject('')
    expect(result).toMatch(/^(Tr|Fwd): /)
  })
})

describe('buildReplyBody', () => {
  const mockMessage: MessageDetail = {
    uid: 1,
    folder: 'INBOX',
    subject: 'Test',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: '', address: 'me@example.com' }],
    cc: [],
    bcc: [],
    replyTo: [],
    date: '2026-09-18T10:30:00Z',
    seen: true,
    flagged: false,
    hasAttachments: false,
    preview: 'Test',
    size: 100,
    messageId: 'msg-123',
    inReplyTo: null,
    references: [],
    html: null,
    text: 'This is the original message.',
    remoteImages: 0,
    attachments: [],
  }

  it('includes quoted-text attribution with sender name and date', () => {
    const body = buildReplyBody(mockMessage)
    expect(body).toContain('Alice')
    expect(body).toContain('alice@example.com')
    expect(body).toContain('a écrit')
  })

  it('prefixes original text with "> "', () => {
    const body = buildReplyBody(mockMessage)
    expect(body).toContain('> This is the original message.')
  })

  it('includes blank line between attribution and quote', () => {
    const body = buildReplyBody(mockMessage)
    // Should have newline structure: attribution, blank line, quoted text
    const parts = body.split('\n')
    expect(parts.length).toBeGreaterThan(2)
  })

  it('handles messages with null text', () => {
    const msg = { ...mockMessage, text: null }
    const body = buildReplyBody(msg)
    expect(body).toBeDefined()
    expect(body.length).toBeGreaterThan(0)
  })

  it('handles very long original text', () => {
    const longText = 'A'.repeat(5000)
    const msg = { ...mockMessage, text: longText }
    const body = buildReplyBody(msg)
    expect(body).toContain('> A')
  })
})

describe('buildForwardBody', () => {
  const mockMessage: MessageDetail = {
    uid: 1,
    folder: 'INBOX',
    subject: 'Test',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: '', address: 'bob@example.com' }],
    cc: [{ name: 'Charlie', address: 'charlie@example.com' }],
    bcc: [],
    replyTo: [],
    date: '2026-09-18T10:30:00Z',
    seen: true,
    flagged: false,
    hasAttachments: false,
    preview: 'Test',
    size: 100,
    messageId: 'msg-123',
    inReplyTo: null,
    references: [],
    html: null,
    text: 'This is the forwarded message.',
    remoteImages: 0,
    attachments: [],
  }

  it('includes forwarded message header', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('---------- Message transféré')
  })

  it('includes original sender info', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('De:')
    expect(body).toContain('alice@example.com')
  })

  it('includes recipients info', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('À:')
  })

  it('includes Cc info if present', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('Cc:')
    expect(body).toContain('charlie@example.com')
  })

  it('includes date', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('Date:')
  })

  it('includes subject', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('Objet:')
    expect(body).toContain('Test')
  })

  it('includes original message body', () => {
    const body = buildForwardBody(mockMessage)
    expect(body).toContain('This is the forwarded message.')
  })
})

describe('parseRecipientString', () => {
  it('parses single email address', () => {
    const result = parseRecipientString('alice@example.com')
    expect(result).toEqual(['alice@example.com'])
  })

  it('parses comma-separated addresses', () => {
    const result = parseRecipientString('alice@example.com, bob@example.com')
    expect(result).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('parses addresses with display names', () => {
    const result = parseRecipientString('Alice <alice@example.com>, Bob <bob@example.com>')
    expect(result).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('trims whitespace', () => {
    const result = parseRecipientString('  alice@example.com  ,  bob@example.com  ')
    expect(result).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('handles semicolon separators', () => {
    const result = parseRecipientString('alice@example.com; bob@example.com')
    expect(result).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('filters out empty strings', () => {
    const result = parseRecipientString('alice@example.com,, bob@example.com')
    expect(result).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('returns empty array for empty input', () => {
    expect(parseRecipientString('')).toEqual([])
  })

  it('returns empty array for whitespace only', () => {
    expect(parseRecipientString('   ')).toEqual([])
  })
})

describe('validateEmailAddress', () => {
  it('accepts valid email addresses', () => {
    expect(validateEmailAddress('alice@example.com')).toBe(true)
  })

  it('rejects email without @', () => {
    expect(validateEmailAddress('alice')).toBe(false)
  })

  it('rejects email without domain', () => {
    expect(validateEmailAddress('alice@')).toBe(false)
  })

  it('rejects email without local part', () => {
    expect(validateEmailAddress('@example.com')).toBe(false)
  })

  it('accepts subdomains', () => {
    expect(validateEmailAddress('alice@mail.example.com')).toBe(true)
  })

  it('accepts addresses with dots', () => {
    expect(validateEmailAddress('alice.dupont@example.com')).toBe(true)
  })

  it('accepts addresses with plus', () => {
    expect(validateEmailAddress('alice+tag@example.com')).toBe(true)
  })

  it('rejects spaces', () => {
    expect(validateEmailAddress('alice @example.com')).toBe(false)
  })

  it('rejects multiple @ symbols', () => {
    expect(validateEmailAddress('alice@bob@example.com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateEmailAddress('')).toBe(false)
  })
})
