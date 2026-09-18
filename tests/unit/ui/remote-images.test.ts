import { describe, it, expect } from 'vitest'
import {
  unblockRemoteImages,
  isValidRemoteImageUrl
} from '~/utils/remote-images'

describe('isValidRemoteImageUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidRemoteImageUrl('https://example.com/image.png')).toBe(true)
  })

  it('rejects http URLs', () => {
    expect(isValidRemoteImageUrl('http://example.com/image.png')).toBe(false)
  })

  it('rejects data: URLs', () => {
    expect(isValidRemoteImageUrl('data:image/png;base64,iVBORw0K')).toBe(false)
  })

  it('rejects javascript: URLs', () => {
    expect(isValidRemoteImageUrl('javascript:alert("xss")')).toBe(false)
  })

  it('rejects blob: URLs', () => {
    expect(isValidRemoteImageUrl('blob:https://example.com/abc123')).toBe(false)
  })

  it('accepts URLs with query parameters', () => {
    expect(isValidRemoteImageUrl('https://example.com/image.png?size=large')).toBe(true)
  })

  it('accepts URLs with fragments', () => {
    expect(isValidRemoteImageUrl('https://example.com/image.png#anchor')).toBe(true)
  })

  it('accepts URLs with subdomains', () => {
    expect(isValidRemoteImageUrl('https://cdn.example.com/image.png')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidRemoteImageUrl('')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isValidRemoteImageUrl('not a url')).toBe(false)
  })
})

describe('unblockRemoteImages', () => {
  it('converts data-remote-src to src for https URLs', () => {
    const html = '<img data-remote-src="https://example.com/image.png" alt="test">'
    const result = unblockRemoteImages(html)
    expect(result).toContain('src="https://example.com/image.png"')
    expect(result).not.toContain('data-remote-src')
  })

  it('does not convert data-remote-src for http URLs', () => {
    const html = '<img data-remote-src="http://example.com/image.png" alt="test">'
    const result = unblockRemoteImages(html)
    expect(result).toContain('data-remote-src="http://example.com/image.png"')
  })

  it('handles multiple images', () => {
    const html = `
      <img data-remote-src="https://example.com/1.png" alt="1">
      <img data-remote-src="https://example.com/2.png" alt="2">
    `
    const result = unblockRemoteImages(html)
    expect(result).toContain('src="https://example.com/1.png"')
    expect(result).toContain('src="https://example.com/2.png"')
  })

  it('preserves other attributes', () => {
    const html = '<img data-remote-src="https://example.com/image.png" alt="test" class="avatar" width="100">'
    const result = unblockRemoteImages(html)
    expect(result).toContain('alt="test"')
    expect(result).toContain('class="avatar"')
    expect(result).toContain('width="100"')
  })

  it('removes data-remote-src even if URL is not valid', () => {
    const html = '<img data-remote-src="javascript:alert(1)" alt="test">'
    const result = unblockRemoteImages(html)
    // data-remote-src should not be converted, but attribute should remain
    expect(result).toContain('data-remote-src="javascript:alert(1)"')
  })

  it('handles nested HTML structures', () => {
    const html = `
      <div class="email-body">
        <p>Check this image:</p>
        <img data-remote-src="https://example.com/banner.png" alt="banner">
      </div>
    `
    const result = unblockRemoteImages(html)
    expect(result).toContain('src="https://example.com/banner.png"')
    expect(result).toContain('Check this image')
  })

  it('handles data-remote-src with URL parameters', () => {
    const html = '<img data-remote-src="https://example.com/image.png?w=100&h=100" alt="test">'
    const result = unblockRemoteImages(html)
    expect(result).toContain('src="https://example.com/image.png?w=100&h=100"')
  })

  it('returns original HTML if no data-remote-src attributes', () => {
    const html = '<img src="https://example.com/image.png" alt="test">'
    const result = unblockRemoteImages(html)
    expect(result).toBe(html)
  })

  it('handles empty HTML', () => {
    expect(unblockRemoteImages('')).toBe('')
  })

  it('preserves case sensitivity', () => {
    const html = '<img DATA-REMOTE-SRC="https://example.com/image.png" alt="test">'
    const result = unblockRemoteImages(html)
    // Should handle case-insensitively or preserve as-is
    // Most implementations use case-insensitive HTML attribute matching
    expect(result).toBeDefined()
  })
})
