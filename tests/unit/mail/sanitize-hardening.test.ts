import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from '../../../server/lib/mail/sanitize'

const clean = (html: string, inline: Record<string, string> = {}) => sanitizeEmailHtml(html, inline)

describe('sanitizeEmailHtml — hardening (orchestrator review)', () => {
  it('should not let a <style> end-tag variant smuggle markup past the sanitizer', () => {
    const { html } = clean('<style>a{}</style x><img src=x onerror=alert(1)></style><p>ok</p>')
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toMatch(/alert\(1\)/)
  })

  it('should strip quoted remote url() in <style> blocks', () => {
    const { html } = clean('<style>body{background:url("https://t.example/p.gif")}</style><p>x</p>')
    expect(html).not.toContain('t.example')
  })

  it('should strip quoted remote url() in style attributes', () => {
    const { html } = clean(`<div style='background:url("https://t.example/p.gif");color:red'>x</div>`)
    expect(html).not.toContain('t.example')
    expect(html).toContain('color')
  })

  it('should strip CSS-escaped url() tricks', () => {
    const { html } = clean(String.raw`<div style="background:u\72l(https://t.example/x.gif)">x</div>`)
    expect(html).not.toContain('t.example')
  })

  it('should neutralize protocol-relative image URLs', () => {
    const r = clean('<img src="//t.example/p.gif" width="1" height="1">')
    expect(r.html).not.toMatch(/\ssrc="\/\//)
    expect(r.remoteImages).toBe(1)
  })

  it('should neutralize the legacy background attribute', () => {
    const r = clean('<table><tr><td background="https://t.example/bg.png">x</td></tr></table>')
    expect(r.html).not.toContain('t.example')
    expect(r.remoteImages).toBe(1)
  })

  it('should keep common email layout attributes and tags', () => {
    const { html } = clean('<table width="600" cellpadding="0" border="0"><tr><td align="center" bgcolor="#ffffff" class="hero" colspan="2"><font color="red" face="Arial">Salut</font><center>c</center></td></tr></table>')
    for (const attr of ['align="center"', 'bgcolor="#ffffff"', 'class="hero"', 'colspan="2"', 'cellpadding="0"', '<font', '<center']) {
      expect(html).toContain(attr)
    }
  })

  it('should keep a leading safe <style> block', () => {
    const { html } = clean('<style>.hero{color:#123456}</style><p class="hero">x</p>')
    expect(html).toContain('#123456')
  })

  it('should drop SVG data URIs on images', () => {
    const { html } = clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')
    expect(html).not.toContain('image/svg')
  })

  it('should drop data: URLs from links', () => {
    const { html } = clean('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')
    expect(html).not.toContain('data:')
  })

  it('should never leave a remote src/srcset in the output', () => {
    const { html } = clean('<img src="HTTPS://T.EXAMPLE/a.png"><img srcset="https://t.example/a.png 1x, https://t.example/b.png 2x"><picture><source srcset="https://t.example/c.webp"></picture>')
    expect(html).not.toMatch(/\s(src|srcset)="(https?:)?\/\//i)
  })

  it('should not execute-able attributes survive on any element', () => {
    const { html } = clean('<div onclick="x()" onmouseover="y()"><a href="#" onfocus="z()">l</a></div>')
    expect(html).not.toMatch(/\son\w+=/i)
  })
})

describe('parseMessage — attachments with Content-ID (orchestrator review)', () => {
  it('should keep a Content-ID attachment that the HTML never references', async () => {
    const { parseMessage, getAttachment } = await import('../../../server/lib/mail/parse')
    const MailComposer = (await import('nodemailer/lib/mail-composer')).default
    const raw = await new Promise<Buffer>((resolve, reject) => {
      new MailComposer({
        from: 'a@universite.example',
        to: 'b@universite.example',
        subject: 'cid',
        html: '<p>Bonjour <img src="cid:logo@x"></p>',
        attachments: [
          { filename: 'logo.png', content: Buffer.from('iVBORw0KGgo=', 'base64'), contentType: 'image/png', cid: 'logo@x' },
          { filename: 'rapport.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf', cid: 'apple-style@x' },
        ],
      }).compile().build((err, msg) => (err ? reject(err) : resolve(msg)))
    })
    const detail = await parseMessage(raw, { uid: 1, folder: 'INBOX', seen: false, flagged: false, size: raw.length })
    expect(detail.attachments.map(a => a.filename)).toEqual(['rapport.pdf'])
    expect(detail.html).toContain('src="data:image/png;base64,')
    const file = await getAttachment(raw, '0')
    expect(file?.filename).toBe('rapport.pdf')
    expect(await getAttachment(raw, '1')).toBeNull()
    expect(await getAttachment(raw, '../0')).toBeNull()
  })
})

describe('buildRawMessage — Bcc handling (orchestrator review)', () => {
  const payload = { to: ['b@universite.example'], cc: [], bcc: ['secret@universite.example'], subject: 'x', text: 'y' }

  it('should never put Bcc in the message sent over SMTP', async () => {
    const { buildRawMessage } = await import('../../../server/lib/mail/compose')
    expect((await buildRawMessage('a@universite.example', payload)).toString()).not.toContain('secret@')
  })

  it('should keep Bcc in stored copies when asked', async () => {
    const { buildRawMessage } = await import('../../../server/lib/mail/compose')
    const raw = await buildRawMessage('a@universite.example', payload, { keepBcc: true, messageId: '<fixed@universite.example>' })
    expect(raw.toString()).toMatch(/^Bcc: secret@universite.example/m)
    expect(raw.toString()).toContain('Message-ID: <fixed@universite.example>')
  })
})
