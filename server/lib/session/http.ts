/**
 * Build a Content-Disposition header for attachment downloads.
 * Uses RFC 5987 for UTF-8 filenames with ASCII fallback.
 */
export function buildContentDisposition(filename: string): string {
  // Remove path separators and CR/LF
  const clean = filename
    .replace(/[/\\]/g, '')
    .replace(/[\r\n]/g, '')
    .replace(/"/g, '')

  // Create ASCII fallback (remove non-ASCII, replace with underscore)
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_').substring(0, 255)

  // RFC 5987: filename*=charset'lang'encoded-value
  const utf8Encoded = encodeURIComponent(clean).replace(/%20/g, ' ')

  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8Encoded}`
}
