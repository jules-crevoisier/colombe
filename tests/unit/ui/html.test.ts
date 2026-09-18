import { describe, expect, it } from 'vitest'
import { escapeHtml, signatureBlock, textToHtml } from '../../../app/utils/html'

describe('html utils', () => {
  it('should escape markup', () => {
    expect(escapeHtml('<img src=x onerror="a">&\'')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
  })
  it('should turn text into paragraphs and line breaks', () => {
    expect(textToHtml('Bonjour,\nmerci\n\n<b>Léa</b>')).toBe('<p>Bonjour,<br>merci</p><p>&lt;b&gt;Léa&lt;/b&gt;</p>')
  })
  it('should build a signature block only when there is a signature', () => {
    expect(signatureBlock('')).toBe('')
    expect(signatureBlock('<p>Léa<br>MMI</p>')).toBe('<p>--</p><p>Léa<br>MMI</p>')
  })
})
