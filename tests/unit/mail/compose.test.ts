import { describe, it, expect } from 'vitest'
import { buildRawMessage } from '../../../server/lib/mail/compose'
import type { ComposePayload } from '#shared/types/mail'

describe('buildRawMessage', () => {
  it('builds a basic message', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test Subject',
      text: 'Hello World',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    expect(raw).toBeInstanceOf(Buffer)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('subject:')
    expect(str).toContain('Test Subject')
    expect(str).toContain('Hello World')
  })

  it('includes from address', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('alice@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('from:')
    expect(str).toContain('alice@example.com')
  })

  it('includes to recipients', async () => {
    const payload: ComposePayload = {
      to: ['alice@example.com', 'bob@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('to:')
    expect(str).toContain('alice@example.com')
    expect(str).toContain('bob@example.com')
  })

  it('includes cc recipients', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: ['cc@example.com'],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('cc:')
    expect(str).toContain('cc@example.com')
  })

  it('excludes bcc from message headers', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: ['secret@example.com'],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    // bcc should not appear in the message header
    expect(str.toUpperCase()).not.toContain('BCC:')
  })

  it('includes Date header', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('date:')
  })

  it('includes Message-ID header', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('message-id:')
  })

  it('generates Message-ID with sender domain', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('alice@universite.example', payload)
    const str = raw.toString()
    expect(str).toContain('universite.example')
  })

  it('includes inReplyTo when provided', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Re: Original',
      text: 'Reply',
      inReplyTo: '<original@example.com>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('in-reply-to:')
    expect(str).toContain('original@example.com')
  })

  it('includes references when provided', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
      references: ['<msg1@example.com>', '<msg2@example.com>'],
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('references:')
  })

  it('handles subject with special characters', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test: Café — Déjà vu',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    expect(raw).toBeInstanceOf(Buffer)
    expect(raw.length).toBeGreaterThan(0)
  })

  it('prevents header injection in subject', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test\nBcc: attacker@example.com',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    // The newline should be encoded or rejected, not create a real BCC header
    expect(str).not.toMatch(/^Bcc:\s*attacker@example.com/mi)
  })

  it('prevents header injection in addresses', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com\nBcc: attacker@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).not.toMatch(/^Bcc:\s*attacker@example.com/mi)
  })

  it('includes text body', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'This is the email body with some content.',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('This is the email body')
  })

  it('handles attachments (base64 encoded)', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test with attachment',
      text: 'See attachment',
      attachments: [
        {
          filename: 'file.txt',
          contentType: 'text/plain',
          content: Buffer.from('attachment content').toString('base64'),
        },
      ],
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    expect(raw).toBeInstanceOf(Buffer)
    const str = raw.toString()
    expect(str).toContain('Content-Disposition: attachment')
    expect(str).toContain('file.txt')
  })

  it('handles multiple attachments', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test with multiple attachments',
      text: 'See attachments',
      attachments: [
        {
          filename: 'file1.txt',
          contentType: 'text/plain',
          content: Buffer.from('content1').toString('base64'),
        },
        {
          filename: 'file2.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('pdf bytes').toString('base64'),
        },
      ],
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('file1.txt')
    expect(str).toContain('file2.pdf')
  })

  it('handles CRLF line endings', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Line1\nLine2\nLine3',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    // RFC 822 should use CRLF
    expect(raw.toString()).toMatch(/\r\n/)
  })

  it('handles empty cc and bcc arrays', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str.toLowerCase()).toContain('to:')
  })

  it('ignores html in payload (text-only)', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Plain text body',
      // Note: per spec, HTML input is not accepted
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Plain text body')
  })

  it('handles draftUid without including it', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Body',
      draftUid: 42,
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    // draftUid should not appear in the message
    expect(raw.toString()).not.toMatch(/draft-?uid/i)
  })
})
