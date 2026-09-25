import { describe, expect, it } from 'vitest'
import { dateKey, localDate, monthDays, moveDate, moveMonth } from './organizerDates'

describe('local organizer dates', () => {
  it('keeps leap days and month/year transitions as local calendar dates', () => {
    expect(moveDate('2024-02-28', 1)).toBe('2024-02-29')
    expect(moveDate('2024-02-29', 1)).toBe('2024-03-01')
    expect(moveMonth('2026-12', 1)).toBe('2027-01')
    expect(moveMonth('2026-01', -1)).toBe('2025-12')
    expect(dateKey(localDate('2026-03-29'))).toBe('2026-03-29')
    expect(moveDate('2026-03-29', 1)).toBe('2026-03-30')
    expect(dateKey(localDate('0001-01-01'))).toBe('0001-01-01')
  })
  it('aligns the month grid to the selected first weekday', () => {
    expect(monthDays('2026-09', 1)).toHaveLength(42)
    expect(monthDays('2026-09', 1)[0]).toBe('2026-08-31')
    expect(monthDays('2026-09', 0)[0]).toBe('2026-08-30')
    expect(monthDays('2024-02', 1)).toContain('2024-02-29')
  })
})
