import { describe, expect, it } from 'vitest'
import { htmlToText, sanitizeOutgoingHtml } from '../../../server/lib/mail/sanitize-outgoing'

describe('sanitizeOutgoingHtml', () => {
  it('should keep editor formatting', () => {
    const html = '<p><strong>Gras</strong> <em>ital</em> <u>s</u></p><ul><li>un</li></ul><blockquote>cit</blockquote>'
    expect(sanitizeOutgoingHtml(html)).toBe(html)
  })

  it('should strip scripts, handlers, styles, images, iframes and forms', () => {
    const out = sanitizeOutgoingHtml('<p style="color:red" onclick="x()">a</p><img src="https://t/p.gif"><script>alert(1)</script><iframe src="x"></iframe><form><input></form>')
    for (const bad of ['style', 'onclick', '<img', '<script', 'alert', '<iframe', '<form', '<input']) expect(out).not.toContain(bad)
    expect(out).toContain('<p>a</p>')
  })

  it('should only allow http(s) and mailto links', () => {
    expect(sanitizeOutgoingHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript')
    expect(sanitizeOutgoingHtml('<a href="data:text/html,x">x</a>')).not.toContain('data:')
    expect(sanitizeOutgoingHtml('<a href="https://mmi-troyes.fr">x</a>')).toBe('<a rel="noopener noreferrer" href="https://mmi-troyes.fr">x</a>')
  })
})

describe('htmlToText', () => {
  it('should produce a readable plain-text part', () => {
    expect(htmlToText('<p>Bonjour <strong>Alice</strong></p><ul><li>un</li><li>deux</li></ul><p><a href="https://x.fr">site</a> &amp; co</p>'))
      .toBe('Bonjour Alice\n• un\n• deux\nsite (https://x.fr) & co')
  })
})
