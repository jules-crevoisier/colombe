/**
 * Extract HTTP status code from an error object.
 * Handles various error formats (FetchError, Error with status properties, etc.)
 */
export function statusOf(err: unknown): number | undefined {
  if (err == null) return undefined

  const errObj = err as Record<string, unknown>

  // Try statusCode first (Nuxt FetchError)
  if (typeof errObj.statusCode === 'number') {
    return errObj.statusCode
  }

  // Try status (standard fetch Response)
  if (typeof errObj.status === 'number') {
    return errObj.status
  }

  // Try response.status (wrapped response)
  const response = errObj.response as Record<string, unknown> | undefined
  if (response && typeof response.status === 'number') {
    return response.status
  }

  return undefined
}

/**
 * Extract error message from an error object.
 */
export function messageOf(err: unknown): string {
  if (err == null) return 'Unknown error'

  if (typeof err === 'string') {
    return err
  }

  const errObj = err as Record<string, unknown>

  if (typeof errObj.message === 'string') {
    return errObj.message
  }

  if (typeof errObj.statusText === 'string') {
    return errObj.statusText
  }

  return 'Unknown error'
}
