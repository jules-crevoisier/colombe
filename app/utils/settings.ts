/**
 * Escape plain text signature for safe HTML rendering.
 * Escapes HTML special characters first, then converts newlines to <br> tags.
 */
export function escapeSignatureText(text: string): string {
  // Escape HTML special characters (order matters: & first)
  let escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')

  // Convert newlines to <br>
  escaped = escaped.replaceAll('\n', '<br>')

  return escaped
}

/**
 * Convert HTML signature back to plain text.
 * Converts <br> variants to newlines, decodes entities, and strips remaining HTML tags.
 */
export function unescapeSignatureHtml(html: string): string {
  // Convert <br> variants to newlines (must preserve text around them)
  let text = html
    .replaceAll(/<br\s*\/?>/gi, '\n')

  // Decode HTML entities
  text = text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")

  // Strip remaining HTML tags
  text = text.replaceAll(/<[^>]*>/g, '')

  return text
}
