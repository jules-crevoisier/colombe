import { z } from 'zod'
import type { MessageSource } from '#shared/types/mail'
import { mailError, requireMail } from '../../../utils/mail-session'

const paramsSchema = z.object({ uid: z.coerce.number().int().positive() })
const querySchema = z.object({
  folder: z.string().min(1).max(512),
})

function decodeRfc2047(encoded: string): string {
  return encoded.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (match, charset, encoding, text) => {
    try {
      const buf = encoding === 'B' || encoding === 'b'
        ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/g, ' '), 'latin1')
      return buf.toString(charset)
    } catch {
      return match
    }
  })
}

function parseHeaders(raw: Buffer): Array<{ name: string; value: string }> {
  const text = raw.toString('utf-8', 0, Math.min(65536, raw.length))
  const lines = text.split('\r\n')
  const headers: Array<{ name: string; value: string }> = []
  let currentName = ''
  let currentValue = ''

  for (const line of lines) {
    if (!line) break
    if (line[0] === ' ' || line[0] === '\t') {
      currentValue += ' ' + line.trim()
    } else {
      if (currentName) {
        headers.push({ name: currentName, value: decodeRfc2047(currentValue) })
      }
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        currentName = line.substring(0, colonIdx)
        currentValue = line.substring(colonIdx + 1).trim()
      } else {
        currentName = ''
        currentValue = ''
      }
    }
  }

  if (currentName) {
    headers.push({ name: currentName, value: decodeRfc2047(currentValue) })
  }

  return headers
}

export default defineEventHandler(async (event): Promise<MessageSource> => {
  try {
    const { uid } = await getValidatedRouterParams(event, p => paramsSchema.parse(p))
    const query = await getValidatedQuery(event, body => querySchema.parse(body))
    const { backend } = await requireMail(event)

    const raw = await backend.getRawMessage(query.folder, uid)
    const headers = parseHeaders(raw)

    const maxBytes = 1024 * 1024
    const source = raw.length > maxBytes
      ? raw.toString('utf-8', 0, maxBytes)
      : raw.toString('utf-8')

    return { headers, source }
  } catch (err: unknown) {
    throw mailError(err, event)
  }
})
