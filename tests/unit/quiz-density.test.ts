import { describe, it, expect } from 'vitest'
import {
  targetDeckSize,
  targetQuestionCount,
  MAX_DECK_QUESTIONS,
  DECK_HALF_TOKENS,
  PER_UNIT_MAX_QUESTIONS,
} from '../../src/main/services/quiz/prompts'

describe('targetDeckSize', () => {
  it('is zero for an empty document and positive otherwise', () => {
    expect(targetDeckSize(0)).toBe(0)
    expect(targetDeckSize(500)).toBeGreaterThan(0)
  })

  it('is monotonically increasing in document size', () => {
    const sizes = [500, 2_000, 6_000, 20_000, 60_000, 200_000]
    for (let i = 1; i < sizes.length; i += 1) {
      expect(targetDeckSize(sizes[i]!)).toBeGreaterThan(targetDeckSize(sizes[i - 1]!))
    }
  })

  it('saturates: never reaches MAX_DECK_QUESTIONS even for a huge document', () => {
    expect(targetDeckSize(10_000_000)).toBeLessThan(MAX_DECK_QUESTIONS)
    expect(targetDeckSize(10_000_000)).toBeGreaterThan(MAX_DECK_QUESTIONS * 0.9)
  })

  it('hits half of MAX_DECK_QUESTIONS at DECK_HALF_TOKENS', () => {
    expect(targetDeckSize(DECK_HALF_TOKENS)).toBeCloseTo(MAX_DECK_QUESTIONS / 2, 5)
  })

  it('grows sub-linearly — density (questions per token) falls as docs get bigger', () => {
    const densitySmall = targetDeckSize(2_000) / 2_000
    const densityLarge = targetDeckSize(60_000) / 60_000
    expect(densityLarge).toBeLessThan(densitySmall)
  })
})

describe('targetQuestionCount', () => {
  it('clamps to [1, PER_UNIT_MAX_QUESTIONS]', () => {
    // Tiny unit in a large doc → floored at 1.
    expect(targetQuestionCount(40, 100_000)).toBe(1)
    // Whole small doc as one unit → capped at the per-unit ceiling.
    expect(targetQuestionCount(5_000, 5_000)).toBeLessThanOrEqual(PER_UNIT_MAX_QUESTIONS)
    expect(targetQuestionCount(5_000, 5_000)).toBeGreaterThanOrEqual(1)
  })

  it('asks for MORE questions from a unit in a small doc than the same unit in a big doc', () => {
    // Identical 600-token unit, different surrounding document sizes.
    const inSmallDoc = targetQuestionCount(600, 2_000)
    const inBigDoc = targetQuestionCount(600, 80_000)
    expect(inSmallDoc).toBeGreaterThan(inBigDoc)
  })

  it('per-unit targets sum to roughly the document-wide deck target', () => {
    // A 6k-token doc split into ten ~600-token units.
    const docTokens = 6_000
    const units = Array.from({ length: 10 }, () => 600)
    const summed = units.reduce((s, u) => s + targetQuestionCount(u, docTokens), 0)
    const deck = targetDeckSize(docTokens)
    // Rounding per unit drifts a little, but they should be in the same ballpark.
    expect(Math.abs(summed - deck)).toBeLessThanOrEqual(units.length)
  })

  it('defaults to 1 for a degenerate zero-token document', () => {
    expect(targetQuestionCount(0, 0)).toBe(1)
  })
})
