import { describe, it, expect } from 'vitest'
import { buildContentDisposition } from '../../../server/lib/session/http'

describe('buildContentDisposition', () => {
  it('builds simple ASCII filename', () => {
    const result = buildContentDisposition('document.pdf')
    expect(result).toContain('attachment')
    expect(result).toContain('filename="document.pdf"')
    expect(result).toContain("filename*=UTF-8''document.pdf")
  })

  it('encodes UTF-8 filename with fallback', () => {
    const result = buildContentDisposition('rapport final.pdf')
    expect(result).toContain('attachment; filename="')
    expect(result).toContain('rapport final')
    expect(result).toContain("filename*=UTF-8''")
  })

  it('handles non-ASCII characters', () => {
    const result = buildContentDisposition('résumé.txt')
    expect(result).toContain('filename="')
    expect(result).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.txt")
  })

  it('removes quotes and CR/LF from filename', () => {
    const result = buildContentDisposition('file"with\r\nquote.txt')
    expect(result).not.toContain('\r')
    expect(result).not.toContain('\n')
    // The literal quote should be removed from the filename part
    expect(result).not.toContain('file"with')
  })

  it('handles emoji', () => {
    const result = buildContentDisposition('emoji-🎉.pdf')
    expect(result).toContain("filename*=UTF-8''")
    expect(result).not.toContain('\r')
    expect(result).not.toContain('\n')
  })

  it('escapes special characters in ASCII fallback', () => {
    const result = buildContentDisposition('file"name.pdf')
    expect(result).toContain('filename="')
    // The double quote should be removed or escaped
    const match = result.match(/filename="([^"]+)"/)
    expect(match).toBeTruthy()
    expect(match![1]).not.toContain('"')
  })

  it('handles long UTF-8 filenames', () => {
    const result = buildContentDisposition('très_long_nom_de_fichier_avec_caractères_spéciaux_éàü.pdf')
    expect(result).toContain('attachment; filename=')
    expect(result).toContain("filename*=UTF-8''")
  })

  it('handles filename with slash', () => {
    // Should remove path separators
    const result = buildContentDisposition('path/to/file.pdf')
    expect(result).not.toContain('/')
  })

  it('handles filename with backslash', () => {
    const result = buildContentDisposition('path\\to\\file.pdf')
    expect(result).not.toContain('\\')
  })
})
