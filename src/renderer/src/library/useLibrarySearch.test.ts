import { describe, it, expect } from 'vitest'
import { datePresetToAddedAfter, sizePresetToBounds } from './useLibrarySearch'

const DAY = 86_400

describe('datePresetToAddedAfter', () => {
  it('returns null for "any" (no date filter)', () => {
    expect(datePresetToAddedAfter('any', 1_000_000)).toBeNull()
  })

  it('subtracts the preset window from now (epoch seconds)', () => {
    expect(datePresetToAddedAfter('7d', 1_000_000)).toBe(1_000_000 - 7 * DAY)
    expect(datePresetToAddedAfter('30d', 1_000_000)).toBe(1_000_000 - 30 * DAY)
    expect(datePresetToAddedAfter('year', 1_000_000)).toBe(1_000_000 - 365 * DAY)
  })
})

describe('sizePresetToBounds', () => {
  it('returns no bounds for "any"', () => {
    expect(sizePresetToBounds('any')).toEqual({ minBytes: null, maxBytes: null })
  })

  it('maps small/medium/large to byte ranges', () => {
    expect(sizePresetToBounds('small')).toEqual({ minBytes: null, maxBytes: 1_000_000 })
    expect(sizePresetToBounds('medium')).toEqual({ minBytes: 1_000_000, maxBytes: 10_000_000 })
    expect(sizePresetToBounds('large')).toEqual({ minBytes: 10_000_000, maxBytes: null })
  })
})
