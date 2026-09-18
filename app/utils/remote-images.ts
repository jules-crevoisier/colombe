/**
 * Check if a URL is a valid remote image URL (https only, no javascript: or data:).
 */
export function isValidRemoteImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }

  try {
    // Only allow https:
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Unblock remote images by converting data-remote-src to src attributes.
 * Only converts URLs that pass isValidRemoteImageUrl (https only).
 */
export function unblockRemoteImages(html: string): string {
  if (!html) {
    return html
  }

  // Find all img tags with data-remote-src and replace with src if URL is valid
  // Use a regex to match data-remote-src attributes
  return html.replace(/data-remote-src="([^"]*)"/g, (match, url) => {
    if (isValidRemoteImageUrl(url)) {
      return `src="${url}"`
    }
    // Leave the attribute unchanged if URL is not valid
    return match
  })
}
