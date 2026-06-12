import { describe, it, expect } from 'vitest'
import {
  fitsUtilityContext,
  UTILITY_CONTEXT_MAX_TOKENS,
  UTILITY_GEN_DEFAULT_RESERVE,
} from '@main/services/workers/llmRouting'

// Raw utility generations (contextualize, expand-queries, titles, small quiz
// calls) run on a small dedicated context so they stop trashing the main chat
// sequence's KV state between asks — that state holds the [system][pinned]
// [history] prefix that makes per-turn prefill cheap. Generations that don't
// fit the utility window fall back to the main session (status quo).
describe('fitsUtilityContext', () => {
  it('routes a small generation to the utility context', () => {
    expect(fitsUtilityContext(800, 96, 4096)).toBe(true)
  })

  it('rejects when prompt + reserved output exceed the utility window', () => {
    expect(fitsUtilityContext(3500, 1024, 4096)).toBe(false)
  })

  it('reserves a default output budget when maxTokens is not set', () => {
    // Default reserve keeps an unbounded generation from context-shifting the
    // utility window: a prompt that leaves less than the reserve must fall
    // back to the main session.
    expect(fitsUtilityContext(4096 - UTILITY_GEN_DEFAULT_RESERVE, undefined, 4096)).toBe(false)
    expect(fitsUtilityContext(1024, undefined, 4096)).toBe(true)
  })

  it('exports a utility window small enough to be cheap', () => {
    expect(UTILITY_CONTEXT_MAX_TOKENS).toBeLessThanOrEqual(8192)
  })
})
