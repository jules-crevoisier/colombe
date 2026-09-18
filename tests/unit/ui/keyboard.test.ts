import { describe, expect, it } from 'vitest'
import { parseDragPayload } from '../../../app/utils/keyboard'

describe('parseDragPayload', () => {
  it('should accept a well-formed payload and drop invalid uids', () => {
    expect(parseDragPayload(JSON.stringify({ folder: 'INBOX', uids: [3, -1, 2.5, 7] }))).toEqual({ folder: 'INBOX', uids: [3, 7] })
  })
  it('should reject garbage from other drag sources', () => {
    expect(parseDragPayload('not json')).toBeNull()
    expect(parseDragPayload(JSON.stringify({ folder: 1, uids: [1] }))).toBeNull()
    expect(parseDragPayload(JSON.stringify({ folder: 'INBOX', uids: [] }))).toBeNull()
  })
})
