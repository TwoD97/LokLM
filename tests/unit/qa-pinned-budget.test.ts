import { describe, it, expect } from 'vitest'
import { pinnedBudgetTokens, PINNED_BUDGET_MAX_TOKENS } from '@main/services/qa/QAService'

// Prefill time scales linearly with prompt tokens and nothing is KV-reused
// across turns, so every pinned token is paid again on every question. A pure
// fraction of the budget (40%) was tuned for ~8K windows; on the real profile
// windows (32K–131K) it balloons to 9.5K–39K tokens of pinned content per
// turn — tens of seconds of prefill. The budget must be capped absolutely.
describe('pinnedBudgetTokens', () => {
  it('returns 0 when nothing is pinned', () => {
    expect(pinnedBudgetTokens(23_900, 0)).toBe(0)
  })

  it('returns 0 for a non-positive budget', () => {
    expect(pinnedBudgetTokens(0, 1)).toBe(0)
    expect(pinnedBudgetTokens(-100, 2)).toBe(0)
  })

  it('gives pinned docs 40% of a tight window (8K-class budget)', () => {
    // ~8K window leaves ~3.3K of packable budget → 40% ≈ 1.3K, under the cap.
    expect(pinnedBudgetTokens(3_300, 1)).toBe(1_320)
  })

  it('caps the pinned share on large windows', () => {
    // 32K window → ~23.9K budget; 40% would be 9.5K. Cap bounds it.
    expect(pinnedBudgetTokens(23_900, 1)).toBe(PINNED_BUDGET_MAX_TOKENS)
    // 131K window → ~97.6K budget; 40% would be 39K. Still the cap.
    expect(pinnedBudgetTokens(97_600, 3)).toBe(PINNED_BUDGET_MAX_TOKENS)
  })
})
