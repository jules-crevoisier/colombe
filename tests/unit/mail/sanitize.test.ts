import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml } from '../../../server/lib/mail/sanitize'

describe('sanitizeEmailHtml', () => {
  it('removes script tags', () => {
    const html = '<p>Hello</p><script>alert("xss")</script>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<script>')
    expect(result.html).not.toContain('alert')
  })

  it('removes onerror attributes', () => {
    const html = '<img src=x onerror=alert(1)>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('onerror')
    expect(result.html).not.toContain('alert')
  })

  it('removes javascript: protocol in href', () => {
    const html = '<a href="javascript:alert(1)">Click</a>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('javascript:')
  })

  it('handles mixed-case javascript: protocol', () => {
    const html = '<a href="JaVaScRiPt:alert(1)">Click</a>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html.toLowerCase()).not.toContain('javascript:')
  })

  it('removes svg elements with scripts', () => {
    const html = '<svg><script>alert(1)</script></svg>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<svg')
    expect(result.html).not.toContain('<script>')
  })

  it('removes iframe elements', () => {
    const html = '<iframe src="evil.com"></iframe>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<iframe')
  })

  it('removes form elements', () => {
    const html = '<form action="/evil"><input type="text"/><button>Submit</button></form>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<form')
    expect(result.html).not.toContain('<input')
    expect(result.html).not.toContain('<button>')
  })

  it('removes meta tags', () => {
    const html = '<meta http-equiv="refresh" content="0;url=evil.com">'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<meta')
  })

  it('adds target="_blank" and rel attributes to links', () => {
    const html = '<a href="https://example.com">Click</a>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).toContain('target="_blank"')
    expect(result.html).toContain('rel=')
    expect(result.html).toContain('noopener')
    expect(result.html).toContain('noreferrer')
    expect(result.html).toContain('nofollow')
  })

  it('neutralizes remote image URLs (http/https)', () => {
    const html = '<img src="https://example.com/image.png">'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).toContain('data-remote-src="https://example.com/image.png"')
    // Ensure original src attribute is not directly present with https URL
    expect(result.html).toMatch(/<img\s[^>]*?data-remote-src=/)
    expect(result.html).not.toMatch(/\s+src\s*=\s*["']https:/)
    expect(result.remoteImages).toBe(1)
  })

  it('removes srcset with remote URLs', () => {
    const html = '<img src="local.png" srcset="https://example.com/image.png 2x">'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('srcset')
    expect(result.remoteImages).toBeGreaterThan(0)
  })

  it('counts 1x1 tracking pixels as remote images', () => {
    const html = '<img src="https://example.com/track.gif" width="1" height="1" alt="">'
    const result = sanitizeEmailHtml(html, {})
    expect(result.remoteImages).toBe(1)
  })

  it('handles cid: URLs with inlineImages replacement', () => {
    const html = '<img src="cid:xyz123">'
    const inlineImages = { xyz123: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
    const result = sanitizeEmailHtml(html, inlineImages)
    expect(result.html).toContain('src="data:image/png;base64')
  })

  it('removes cid: src if not in inlineImages', () => {
    const html = '<img src="cid:unknown">'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('src=')
  })

  it('allows data: URLs for image MIME types', () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).toContain('data:image/png')
  })

  it('removes data: URLs for non-image MIME types', () => {
    const html = '<a href="data:text/html,<script>alert(1)</script>">Click</a>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('data:text/html')
  })

  it('keeps style blocks but removes CSS with remote URLs', () => {
    const html = '<style>body { color: red; }</style><p>Test</p>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).toContain('color: red')
  })

  it('removes CSS with url() pointing to http/https', () => {
    const html = '<style>body { background: url(https://evil.com/bg.gif); }</style>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('https://evil.com/bg.gif')
  })

  it('removes CSS with expression()', () => {
    const html = '<style>body { zoom: expression(alert(1)); }</style>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('expression')
  })

  it('removes CSS with @import', () => {
    const html = '<style>@import url("https://evil.com/style.css");</style>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('@import')
  })

  it('counts CSS url() as remote images', () => {
    const html = '<style>body { background: url(https://example.com/bg.gif); }</style>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.remoteImages).toBeGreaterThan(0)
  })

  it('removes style attributes with remote URLs', () => {
    const html = '<div style="background: url(https://evil.com/bg.gif)">Test</div>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('https://evil.com')
  })

  it('keeps style attributes without remote URLs', () => {
    const html = '<div style="color: red;">Test</div>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).toContain('color: red')
  })

  it('preserves safe HTML structure', () => {
    const html = '<p>Hello <strong>world</strong></p>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).toContain('<p>')
    expect(result.html).toContain('<strong>')
    expect(result.html).toContain('Hello')
  })

  it('handles complex attack payload from specification', () => {
    const html = '<p>Facture</p><img src=x onerror=alert(1)><a href="javascript:void(0)">Bad</a><svg><script>alert(2)</script></svg>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('onerror')
    expect(result.html).not.toContain('javascript:')
    expect(result.html).not.toContain('<svg')
    expect(result.html).not.toContain('<script>')
  })

  it('handles Newsletter with multiple remote images', () => {
    const html = `
      <p>Newsletter</p>
      <img src="https://example.com/image1.png">
      <img src="https://example.com/image2.png">
      <img src="https://example.com/image3.png">
      <img src="https://example.com/track.gif" width="1" height="1">
    `
    const result = sanitizeEmailHtml(html, {})
    expect(result.remoteImages).toBe(4)
  })

  it('removes embed and object tags', () => {
    const html = '<embed src="evil.swf"><object data="evil.swf"></object>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<embed')
    expect(result.html).not.toContain('<object')
  })

  it('removes audio and video tags', () => {
    const html = '<audio src="sound.mp3"></audio><video src="video.mp4"></video>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<audio')
    expect(result.html).not.toContain('<video')
  })

  it('removes base tag', () => {
    const html = '<base href="https://evil.com/"><a href="/path">Link</a>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<base')
  })

  it('removes link tags', () => {
    const html = '<link rel="stylesheet" href="evil.css"><p>Test</p>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<link')
  })

  it('removes math tags', () => {
    const html = '<math><mi>x</mi></math>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<math')
  })

  it('removes frame tag', () => {
    const html = '<frame src="evil.com"></frame>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<frame')
  })

  it('removes textarea and select tags', () => {
    const html = '<textarea>text</textarea><select><option>val</option></select>'
    const result = sanitizeEmailHtml(html, {})
    expect(result.html).not.toContain('<textarea')
    expect(result.html).not.toContain('<select')
  })
})
