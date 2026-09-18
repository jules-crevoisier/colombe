import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatMessageDate, getInitials, getAvatarColorClass } from '~/utils/formatting'

describe('formatMessageDate', () => {
  let realDate: () => number

  beforeEach(() => {
    realDate = Date.now
    // Mock: "2026-09-18 14:30:00 UTC"
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats today\'s date as HH:mm', () => {
    const result = formatMessageDate(new Date('2026-09-18T14:30:00Z').toISOString(), 'fr-FR')
    // Time should be in HH:mm format (roughly around the same time we're mocking)
    expect(result).toMatch(/^\d{2}:\d{2}/)
  })

  it('formats this year\'s dates as "12 sept."', () => {
    const result = formatMessageDate(new Date('2026-05-12T10:15:00Z').toISOString(), 'fr-FR')
    expect(result).toMatch(/^12\s+\w+\.?$/) // "12 sept." or similar
  })

  it('formats past years as dd/mm/yyyy', () => {
    const result = formatMessageDate(new Date('2024-03-15T10:15:00Z').toISOString(), 'fr-FR')
    expect(result).toBe('15/03/2024')
  })

  it('handles edge case: yesterday', () => {
    const yesterday = new Date('2026-09-17T14:30:00Z').toISOString()
    const result = formatMessageDate(yesterday, 'fr-FR')
    // Yesterday is same year, should be "17 sept."
    expect(result).toMatch(/^\d{1,2}\s+\w+\.?/)
  })

  it('handles edge case: same date last year', () => {
    const lastYear = new Date('2025-09-18T14:30:00Z').toISOString()
    const result = formatMessageDate(lastYear, 'fr-FR')
    expect(result).toBe('18/09/2025')
  })
})

describe('getInitials', () => {
  it('returns initials from name with first and last', () => {
    expect(getInitials('Alice Dupont')).toBe('AD')
  })

  it('returns single initial from single name', () => {
    expect(getInitials('Alice')).toBe('A')
  })

  it('returns uppercase initials', () => {
    expect(getInitials('alice dupont')).toBe('AD')
  })

  it('handles multiple spaces between words', () => {
    expect(getInitials('Alice  Dupont')).toBe('AD')
  })

  it('returns empty string for empty input', () => {
    expect(getInitials('')).toBe('')
  })

  it('trims whitespace', () => {
    expect(getInitials('  Alice Dupont  ')).toBe('AD')
  })

  it('handles special characters in names', () => {
    expect(getInitials('Jean-Pierre Müller')).toBe('JM')
  })
})

describe('getAvatarColorClass', () => {
  it('returns consistent color for same input', () => {
    const color1 = getAvatarColorClass('alice@example.com')
    const color2 = getAvatarColorClass('alice@example.com')
    expect(color1).toBe(color2)
  })

  it('returns different colors for different inputs', () => {
    const color1 = getAvatarColorClass('alice@example.com')
    const color2 = getAvatarColorClass('bob@example.com')
    expect(color1).not.toBe(color2)
  })

  it('returns a valid Tailwind color class', () => {
    const color = getAvatarColorClass('alice@example.com')
    // Should be one of the avatar color classes
    const validColors = [
      'bg-red-700', 'bg-blue-700', 'bg-emerald-700', 'bg-amber-700', 'bg-violet-700', 'bg-pink-700'
    ]
    expect(validColors).toContain(color)
  })

  it('is deterministic based on hash', () => {
    // Same email should always produce same color
    const results = new Set()
    for (let i = 0; i < 100; i++) {
      results.add(getAvatarColorClass('test@example.com'))
    }
    expect(results.size).toBe(1)
  })
})
