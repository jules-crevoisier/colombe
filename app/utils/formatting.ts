/**
 * Format a message date according to relative time:
 * - Today: HH:mm
 * - This year: "12 sept."
 * - Other years: dd/mm/yyyy
 */
export function formatMessageDate(dateString: string, locale: string): string {
  const date = new Date(dateString)
  const now = new Date()

  // Check if today
  if (
    date.getUTCDate() === now.getUTCDate() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCFullYear() === now.getUTCFullYear()
  ) {
    return date.toLocaleString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  // Check if same year
  if (date.getUTCFullYear() === now.getUTCFullYear()) {
    return date.toLocaleString(locale, { day: 'numeric', month: 'short' })
  }

  // Past years: dd/mm/yyyy
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Extract initials from a name.
 * E.g. "Alice Dupont" -> "AD"
 */
export function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''

  const words = trimmed.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return ''

  const firstWord = words[0]
  if (!firstWord) return ''

  if (words.length === 1) {
    return firstWord.charAt(0).toUpperCase()
  }

  const lastWord = words[words.length - 1]
  if (!lastWord) return firstWord.charAt(0).toUpperCase()

  return (firstWord.charAt(0) + lastWord.charAt(0)).toUpperCase()
}

/**
 * Generate a deterministic avatar color class from an email or string.
 * Teintes saturées : texte blanc lisible (contraste AA).
 */
export function getAvatarColorClass(email: string): string {
  const colors = ['bg-red-700', 'bg-blue-700', 'bg-emerald-700', 'bg-amber-700', 'bg-violet-700', 'bg-pink-700'] as const

  // Simple hash function
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  const index = Math.abs(hash) % colors.length
  const color = colors[index]
  return color || 'bg-red-100'
}
