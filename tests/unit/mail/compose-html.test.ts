import { describe, expect, it } from 'vitest'
import { buildRawMessage } from '../../../server/lib/mail/compose'
import type { ComposePayload } from '#shared/types/mail'

describe('compose with HTML', () => {
  it('should build multipart/alternative when html is provided', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test with HTML',
      text: 'Plain text',
      html: '<p><strong>Bold text</strong></p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('multipart/alternative')
    expect(str).toContain('text/plain')
    expect(str).toContain('text/html')
    expect(str).toContain('Plain text')
    expect(str).toContain('Bold text')
  })

  it('should include both text and html parts', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Plain text version',
      html: '<p>HTML version</p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Plain text version')
    expect(str).toContain('HTML version')
  })

  it('should sanitize html and preserve no-script content', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test XSS prevention',
      text: 'Text',
      html: '<p>Safe content <script>alert("xss")</script></p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).not.toContain('<script>')
    expect(str).toContain('Safe content')
  })

  it('should handle empty html field', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Plain text only',
      html: '',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Plain text only')
  })

  it('should handle null html field', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Plain text only',
      html: null,
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Plain text only')
  })

  it('should derive text from html if text is empty', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: '',
      html: '<p>Paragraph one</p><p>Paragraph two</p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    // htmlToText should convert this properly
    expect(str).toContain('Paragraph one')
    expect(str).toContain('Paragraph two')
  })

  it('should preserve html formatting: strong, em, links', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Formatting test',
      text: 'Plain',
      html: '<p><strong>Bold</strong> and <em>italic</em> and <a href="https://example.com">link</a></p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Bold')
    expect(str).toContain('italic')
    expect(str).toContain('example.com')
  })

  it('should handle html with attachments', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'With attachment and HTML',
      text: 'Text version',
      html: '<p>HTML version</p>',
      attachments: [
        {
          filename: 'file.txt',
          contentType: 'text/plain',
          content: Buffer.from('file content').toString('base64'),
        },
      ],
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('multipart/mixed')
    expect(str).toContain('multipart/alternative')
    expect(str).toContain('Text version')
    expect(str).toContain('HTML version')
    expect(str).toContain('file.txt')
  })

  it('should sanitize html with onclick handlers', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Text',
      html: '<div onclick="alert(\'xss\')">Click me</div>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).not.toContain('onclick')
    expect(str).toContain('Click me')
  })

  it('should preserve links with proper rel attributes', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Text',
      html: '<p><a href="https://example.com">Click here</a></p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('noopener noreferrer')
    expect(str).toContain('https://example.com')
  })

  it('should handle html with lists', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Text',
      html: '<ul><li>Item 1</li><li>Item 2</li></ul>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Item 1')
    expect(str).toContain('Item 2')
  })

  it('should strip disallowed tags', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: 'Text',
      html: '<p>Text <iframe src="evil.com">frame</iframe></p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).not.toContain('<iframe')
    expect(str).toContain('Text')
  })

  it('should handle text with newlines when deriving from html', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Test',
      text: '',
      html: '<p>Line 1</p><p>Line 2</p><p>Line 3</p>',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    // Should have newlines between paragraphs in text part
    expect(str).toMatch(/Line 1[\s\S]*Line 2[\s\S]*Line 3/)
  })

  it('should maintain backward compatibility: text-only payloads work as before', async () => {
    const payload: ComposePayload = {
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Text only',
      text: 'Just text',
    }
    const raw = await buildRawMessage('sender@example.com', payload)
    const str = raw.toString()
    expect(str).toContain('Just text')
    expect(str).toContain('text/plain')
  })
})
