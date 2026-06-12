/**
 * Translates the AP-9 "Sperre" setting (`security.autoLockMinutes`: 5 | 15 | 60
 * | 0) into the millisecond timeout the AuthService inactivity timer compares
 * idle time against.
 *
 * 0 means "nie" (never lock). It maps to +Infinity rather than 0 because
 * AuthService.setInactivityMs clamps with `Math.max(60_000, ms)` — a literal 0
 * would clamp up to a 1-minute auto-lock, the opposite of what the user asked
 * for. +Infinity survives the clamp and makes `idle >= inactivityMs` never
 * true, so the timer keeps ticking harmlessly but never locks.
 */
export function inactivityMsFromMinutes(minutes: number): number {
  return minutes <= 0 ? Number.POSITIVE_INFINITY : minutes * 60_000
}
