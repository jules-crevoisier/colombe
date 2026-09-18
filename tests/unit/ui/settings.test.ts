import { describe, it, expect } from 'vitest'
import { escapeSignatureText, unescapeSignatureHtml } from '~/utils/settings'

describe('escapeSignatureText', () => {
  it('escapes ampersand', () => {
    expect(escapeSignatureText('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })

  it('escapes less-than sign', () => {
    expect(escapeSignatureText('a < b')).toBe('a &lt; b')
  })

  it('escapes greater-than sign', () => {
    expect(escapeSignatureText('a > b')).toBe('a &gt; b')
  })

  it('escapes double quotes', () => {
    expect(escapeSignatureText('He said "Hello"')).toBe('He said &quot;Hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeSignatureText("It's fine")).toBe('It&#x27;s fine')
  })

  it('replaces newlines with <br>', () => {
    expect(escapeSignatureText('line1\nline2')).toBe('line1<br>line2')
  })

  it('replaces multiple newlines', () => {
    expect(escapeSignatureText('line1\n\nline2')).toBe('line1<br><br>line2')
  })

  it('handles mixed escaping and newlines', () => {
    expect(escapeSignatureText('line1 & <test>\nline2 "quoted"')).toBe(
      'line1 &amp; &lt;test&gt;<br>line2 &quot;quoted&quot;'
    )
  })

  it('handles empty string', () => {
    expect(escapeSignatureText('')).toBe('')
  })

  it('escapes first then converts newlines', () => {
    expect(escapeSignatureText('a&b\nc')).toBe('a&amp;b<br>c')
  })
})

describe('unescapeSignatureHtml', () => {
  it('converts <br> to newlines', () => {
    expect(unescapeSignatureHtml('line1<br>line2')).toBe('line1\nline2')
  })

  it('converts <br/> to newlines', () => {
    expect(unescapeSignatureHtml('line1<br/>line2')).toBe('line1\nline2')
  })

  it('converts <br /> to newlines', () => {
    expect(unescapeSignatureHtml('line1<br />line2')).toBe('line1\nline2')
  })

  it('unescapes &amp;', () => {
    expect(unescapeSignatureHtml('Tom &amp; Jerry')).toBe('Tom & Jerry')
  })

  it('unescapes &lt;', () => {
    expect(unescapeSignatureHtml('a &lt; b')).toBe('a < b')
  })

  it('unescapes &gt;', () => {
    expect(unescapeSignatureHtml('a &gt; b')).toBe('a > b')
  })

  it('unescapes &quot;', () => {
    expect(unescapeSignatureHtml('He said &quot;Hello&quot;')).toBe('He said "Hello"')
  })

  it('unescapes &#x27;', () => {
    expect(unescapeSignatureHtml("It&#x27;s fine")).toBe("It's fine")
  })

  it('strips remaining HTML tags', () => {
    expect(unescapeSignatureHtml('<p>test</p>')).toBe('test')
  })

  it('strips div tags', () => {
    expect(unescapeSignatureHtml('<div>content</div>')).toBe('content')
  })

  it('handles nested tags', () => {
    expect(unescapeSignatureHtml('<div><span>text</span></div>')).toBe('text')
  })

  it('handles empty string', () => {
    expect(unescapeSignatureHtml('')).toBe('')
  })

  it('handles mixed content with line breaks and entities', () => {
    expect(unescapeSignatureHtml('line1 &amp; <br> line2 &quot;test&quot;')).toBe(
      'line1 & \n line2 "test"'
    )
  })

  it('handles multiple line breaks', () => {
    expect(unescapeSignatureHtml('a<br>b<br>c')).toBe('a\nb\nc')
  })
})
