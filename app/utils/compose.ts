import type { MessageDetail, Address } from '#shared/types/mail'

/**
 * Build a reply subject by adding "Re: " prefix if not already present.
 */
export function buildReplySubject(subject: string): string {
  if (subject.toLowerCase().startsWith('re:')) {
    return subject
  }
  return `Re: ${subject}`
}

/**
 * Build a forward subject by adding "Tr: " (French) or "Fwd: " prefix.
 */
export function buildForwardSubject(subject: string): string {
  const trimmed = subject.trim()
  if (trimmed.toLowerCase().startsWith('tr:') || trimmed.toLowerCase().startsWith('fwd:')) {
    return trimmed
  }
  return `Tr: ${trimmed}`
}

/**
 * Build a reply body with quoted text.
 * Format: "Le {date}, {sender} <{addr}> a écrit :\n\n> original text"
 */
export function buildReplyBody(message: MessageDetail): string {
  const senderName = message.from?.name || message.from?.address || 'Unknown'
  const senderAddr = message.from?.address || 'unknown@example.com'

  // Format date as "18 septembre 2026 à 10:30"
  const date = new Date(message.date)
  const dateStr = date.toLocaleString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const originalText = message.text || ''
  const quotedLines = originalText
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')

  return `Le ${dateStr}, ${senderName} <${senderAddr}> a écrit :\n\n${quotedLines}`
}

/**
 * Build a forward body with message envelope.
 */
export function buildForwardBody(message: MessageDetail): string {
  const senderName = message.from?.name || message.from?.address || 'Unknown'
  const senderAddr = message.from?.address || 'unknown@example.com'

  const toList = message.to.map(addr => `${addr.name ? addr.name + ' ' : ''}<${addr.address}>`).join(', ')
  const ccList = message.cc.length > 0
    ? message.cc.map(addr => `${addr.name ? addr.name + ' ' : ''}<${addr.address}>`).join(', ')
    : ''

  const date = new Date(message.date).toLocaleString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  let envelope = '---------- Message transféré ---------\n'
  envelope += `De: ${senderName} <${senderAddr}>\n`
  envelope += `Date: ${date}\n`
  envelope += `Objet: ${message.subject}\n`
  envelope += `À: ${toList}\n`
  if (ccList) {
    envelope += `Cc: ${ccList}\n`
  }
  envelope += '\n'

  const originalText = message.text || ''
  return envelope + originalText
}

/**
 * Parse a recipient string into an array of email addresses.
 * Handles: comma/semicolon separation, display names in angle brackets, whitespace.
 */
export function parseRecipientString(input: string): string[] {
  if (!input || !input.trim()) {
    return []
  }

  // Split on comma or semicolon
  const parts = input.split(/[,;]/)

  return (
    parts
      .map(part => {
        // Extract email from "Name <email>" format
        const match = part.match(/<(.+?)>/)
        if (match && match[1]) {
          return match[1].trim()
        }
        return part.trim()
      })
      // Filter out empty strings and validate
      .filter(addr => addr.length > 0)
  )
}

/**
 * Validate an email address with a simple regex.
 * Accepts most valid email formats without being too strict.
 */
export function validateEmailAddress(email: string): boolean {
  if (!email || email.trim().length === 0) {
    return false
  }

  // Simple regex: non-empty local part @ domain with at least one dot
  // This is a reasonable middle ground between RFC 5321 and practical use
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

/**
 * Get reply-to addresses, excluding the user's own address.
 */
export function getReplyToAddresses(
  message: MessageDetail,
  userEmail: string
): string[] {
  // If there's a Reply-To, use it
  if (message.replyTo && message.replyTo.length > 0) {
    return message.replyTo.map(addr => addr.address)
  }

  // Otherwise reply to sender
  if (message.from) {
    return [message.from.address]
  }

  return []
}

/**
 * Get reply-all addresses (To + Cc, excluding user).
 */
export function getReplyAllAddresses(
  message: MessageDetail,
  userEmail: string
): string[] {
  const addresses = new Set<string>()

  // Add sender (or Reply-To if it exists)
  if (message.replyTo && message.replyTo.length > 0) {
    message.replyTo.forEach(addr => {
      if (addr.address !== userEmail) {
        addresses.add(addr.address)
      }
    })
  } else if (message.from && message.from.address !== userEmail) {
    addresses.add(message.from.address)
  }

  // Add other recipients (excluding self)
  message.to.forEach(addr => {
    if (addr.address !== userEmail) {
      addresses.add(addr.address)
    }
  })

  message.cc.forEach(addr => {
    if (addr.address !== userEmail) {
      addresses.add(addr.address)
    }
  })

  return Array.from(addresses)
}
