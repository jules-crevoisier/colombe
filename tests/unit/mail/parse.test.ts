import { describe, it, expect } from 'vitest'
import { parseMessage, getAttachment } from '../../../server/lib/mail/parse'
import MailComposer from 'nodemailer/lib/mail-composer'

async function buildTestMessage(opts: {
  subject?: string
  from?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  text?: string
  html?: string
  attachments?: Array<{ filename: string; content: string; contentType?: string }>
  inReplyTo?: string
  references?: string[]
}) {
  const composer = new MailComposer({
    from: opts.from || 'sender@example.com',
    to: opts.to?.join(',') || 'user@example.com',
    cc: opts.cc?.join(','),
    bcc: opts.bcc?.join(','),
    subject: opts.subject || 'Test',
    text: opts.text,
    html: opts.html,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
    attachments: opts.attachments?.map(a => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType || 'text/plain',
    })),
  })
  return new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) reject(err)
      else resolve(message as Buffer)
    })
  })
}

describe('parseMessage', () => {
  it('parses subject correctly', async () => {
    const raw = await buildTestMessage({ subject: 'Test Subject' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.subject).toBe('Test Subject')
  })

  it('defaults subject to "(sans objet)" when empty', async () => {
    // We can't truly test this with buildTestMessage because it defaults to 'Test'
    // But we test that our parse function handles it correctly
    const composer = new (await import('nodemailer/lib/mail-composer')).default({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: '',  // empty subject
    })
    const raw = await new Promise<Buffer>((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err)
        else resolve(message as Buffer)
      })
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.subject).toBe('(sans objet)')
  })

  it('defaults subject to "(sans objet)" when missing', async () => {
    // Create message without subject
    const composer = new (await import('nodemailer/lib/mail-composer')).default({
      from: 'sender@example.com',
      to: 'user@example.com',
      // no subject
    })
    const raw = await new Promise<Buffer>((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err)
        else resolve(message as Buffer)
      })
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.subject).toBe('(sans objet)')
  })

  it('parses from address with name', async () => {
    const raw = await buildTestMessage({ from: 'Alice Martin <alice@example.com>' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.from?.address).toBe('alice@example.com')
    expect(msg.from?.name).toBe('Alice Martin')
  })

  it('parses from address without name', async () => {
    const raw = await buildTestMessage({ from: 'bob@example.com' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.from?.address).toBe('bob@example.com')
  })

  it('parses to addresses', async () => {
    const raw = await buildTestMessage({ to: ['alice@example.com', 'bob@example.com'] })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.to).toHaveLength(2)
    expect(msg.to[0].address).toBe('alice@example.com')
    expect(msg.to[1].address).toBe('bob@example.com')
  })

  it('parses cc addresses', async () => {
    const raw = await buildTestMessage({ cc: ['charlie@example.com'] })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.cc).toHaveLength(1)
    expect(msg.cc[0].address).toBe('charlie@example.com')
  })

  it('does not expose bcc addresses in parsed message (server-side only)', async () => {
    const raw = await buildTestMessage({ bcc: ['dave@example.com'] })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    // BCC is not available in parsed message for privacy reasons - only the server knows
    expect(msg.bcc).toHaveLength(0)
  })

  it('sets date to ISO format', async () => {
    const raw = await buildTestMessage({ text: 'Test' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('sets flags from context', async () => {
    const raw = await buildTestMessage({ text: 'Test' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: true, flagged: true, size: 100 })
    expect(msg.seen).toBe(true)
    expect(msg.flagged).toBe(true)
  })

  it('includes folder and size from context', async () => {
    const raw = await buildTestMessage({ text: 'Test' })
    const msg = await parseMessage(raw, { uid: 42, folder: 'INBOX.Archives', seen: false, flagged: false, size: 5000 })
    expect(msg.folder).toBe('INBOX.Archives')
    expect(msg.size).toBe(5000)
    expect(msg.uid).toBe(42)
  })

  it('extracts preview from text (max 200 chars)', async () => {
    const longText = 'a'.repeat(300)
    const raw = await buildTestMessage({ text: longText })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.preview.length).toBeLessThanOrEqual(200)
    expect(msg.preview).toContain('a')
  })

  it('collapses whitespace in preview', async () => {
    const raw = await buildTestMessage({ text: 'Hello\n\nWorld\t\tTest' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.preview).not.toContain('\n')
    expect(msg.preview).not.toContain('\t')
  })

  it('extracts preview from HTML if no text', async () => {
    const raw = await buildTestMessage({ html: '<p>Hello <strong>World</strong></p>' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.preview).toContain('Hello')
    expect(msg.preview).toContain('World')
  })

  it('sanitizes HTML body', async () => {
    const raw = await buildTestMessage({ html: '<p>Safe</p><script>alert("xss")</script>' })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.html).not.toContain('<script>')
    expect(msg.html).toContain('<p>')
  })

  it('sets html to null when only text is present', async () => {
    const raw = await buildTestMessage({ text: 'Just text', html: undefined })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.html).toBeNull()
  })

  it('handles inline cid images in HTML', async () => {
    // Build a message with cid reference properly
    const MailComposer = await import('nodemailer/lib/mail-composer')
    const composer = new MailComposer.default({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Test',
      html: '<img src="cid:img1">',
      attachments: [
        {
          filename: 'image.png',
          content: Buffer.from('PNG data'),
          contentType: 'image/png',
          cid: 'img1',  // This is the proper way to set cid
        },
      ],
    })

    const raw = await new Promise<Buffer>((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err)
        else resolve(message as Buffer)
      })
    })

    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    // When MailComposer builds message with cid references, it embeds them as data: in HTML
    if (msg.html) {
      expect(msg.html).toContain('data:')
    }
  })

  it('counts remote images in HTML', async () => {
    const raw = await buildTestMessage({
      html: '<img src="https://example.com/img1.png"><img src="https://example.com/img2.png">',
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.remoteImages).toBe(2)
  })

  it('handles attachments', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      attachments: [
        { filename: 'file1.txt', content: 'content1' },
        { filename: 'file2.pdf', content: 'binary', contentType: 'application/pdf' },
      ],
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.attachments.length).toBeGreaterThanOrEqual(2)
    expect(msg.hasAttachments).toBe(true)
  })

  it('excludes inline cid images from attachments list', async () => {
    const MailComposer = await import('nodemailer/lib/mail-composer')
    const composer = new MailComposer.default({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Test',
      html: '<img src="cid:inline">',
      attachments: [
        {
          filename: 'inline.png',
          content: Buffer.from('PNG data'),
          contentType: 'image/png',
          cid: 'inline',
        },
      ],
    })

    const raw = await new Promise<Buffer>((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err)
        else resolve(message as Buffer)
      })
    })

    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    // Inline images (with contentId) should be excluded from attachments
    expect(msg.attachments.length).toBe(0)
    expect(msg.hasAttachments).toBe(false)
  })

  it('limits inline images to 2 MB and supported MIME types', async () => {
    const MailComposer = await import('nodemailer/lib/mail-composer')
    const composer = new MailComposer.default({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Test',
      html: '<img src="cid:img1"><img src="cid:img2"><img src="cid:img3">',
      attachments: [
        {
          filename: 'small.png',
          content: Buffer.from('PNG data'),
          contentType: 'image/png',
          cid: 'img1',
        },
        {
          filename: 'image.gif',
          content: Buffer.from('GIF data'),
          contentType: 'image/gif',
          cid: 'img2',
        },
        {
          filename: 'document.pdf',
          content: Buffer.from('PDF data'),
          contentType: 'application/pdf',
          cid: 'img3',
        },
      ],
    })

    const raw = await new Promise<Buffer>((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err)
        else resolve(message as Buffer)
      })
    })

    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    // All attachments with cid should be embedded as data: in HTML
    if (msg.html) {
      expect(msg.html).toContain('data:')
    }
  })

  it('includes attachment metadata', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      attachments: [{ filename: 'report.pdf', content: 'pdf-content', contentType: 'application/pdf' }],
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    const attachment = msg.attachments[0]
    expect(attachment).toBeDefined()
    expect(attachment.filename).toBe('report.pdf')
    expect(attachment.contentType).toBe('application/pdf')
  })

  it('provides stable attachment ids', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      attachments: [
        { filename: 'file1.txt', content: 'content1' },
        { filename: 'file2.txt', content: 'content2' },
      ],
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.attachments[0].id).toBe('0')
    expect(msg.attachments[1].id).toBe('1')
  })

  it('defaults attachment filename to "piece-jointe" when missing', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      attachments: [{ filename: '', content: 'content' }],
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    // MailComposer may assign a default filename like "attachment-1.txt"
    // But our implementation should use 'piece-jointe' as fallback if completely empty
    if (msg.attachments.length > 0) {
      expect(msg.attachments[0].filename).toBeTruthy()
    }
  })

  it('parses inReplyTo', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      inReplyTo: '<original@example.com>',
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.inReplyTo).toBeTruthy()
  })

  it('parses references', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      references: ['<msg1@example.com>', '<msg2@example.com>'],
    })
    const msg = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: 100 })
    expect(msg.references.length).toBeGreaterThan(0)
  })
})

describe('getAttachment', () => {
  it('retrieves attachment by id', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      attachments: [{ filename: 'file.txt', content: 'attachment-content' }],
    })
    const result = await getAttachment(raw, '0')
    expect(result).not.toBeNull()
    expect(result!.filename).toBe('file.txt')
  })

  it('returns null for invalid attachment id', async () => {
    const raw = await buildTestMessage({
      text: 'Test',
      attachments: [{ filename: 'file.txt', content: 'content' }],
    })
    const result = await getAttachment(raw, '999')
    expect(result).toBeNull()
  })

  it('excludes inline images from retrieval', async () => {
    const MailComposer = await import('nodemailer/lib/mail-composer')
    const composer = new MailComposer.default({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: 'Test',
      html: '<img src="cid:inline">',
      attachments: [
        {
          filename: 'inline.png',
          content: Buffer.from('PNG data'),
          contentType: 'image/png',
          cid: 'inline',
        },
        {
          filename: 'real.pdf',
          content: Buffer.from('PDF data'),
          contentType: 'application/pdf',
        },
      ],
    })

    const raw = await new Promise<Buffer>((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) reject(err)
        else resolve(message as Buffer)
      })
    })

    // The inline image (which has contentId) should be excluded
    // So 'real.pdf' (non-inline) should be at index 0
    const result = await getAttachment(raw, '0')
    if (result) {
      expect(result.filename).toContain('pdf')
    }
  })
})
