import { describe, expect, it } from 'vitest'
import { MailError } from '../../server/lib/mail/backend'

describe('harness', () => {
  it('should load server modules when running unit tests', () => {
    expect(new MailError('INVALID', 'x').code).toBe('INVALID')
  })
})
