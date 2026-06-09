import { describe, it, expect } from 'vitest'
import { inactivityMsFromMinutes } from '@main/services/auth/inactivity'

// AP-9 §3.8 "Sperre": the settings UI offers 5 / 15 / 60 minutes or "nie" (0).
// This pure mapping turns that minute value into the millisecond timeout the
// AuthService inactivity timer compares idle time against. 0 ("nie") must map
// to an infinite timeout so the timer never trips — NOT to the 1-minute floor
// that setInactivityMs() would otherwise clamp a literal 0 up to.
describe('inactivityMsFromMinutes', () => {
  it('maps the auto-lock minute presets to milliseconds', () => {
    expect(inactivityMsFromMinutes(5)).toBe(5 * 60_000)
    expect(inactivityMsFromMinutes(15)).toBe(15 * 60_000)
    expect(inactivityMsFromMinutes(60)).toBe(60 * 60_000)
  })

  it('maps 0 ("nie") to an infinite timeout so the session never auto-locks', () => {
    expect(inactivityMsFromMinutes(0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('treats any non-positive value as "never" (defensive)', () => {
    expect(inactivityMsFromMinutes(-5)).toBe(Number.POSITIVE_INFINITY)
  })
})
