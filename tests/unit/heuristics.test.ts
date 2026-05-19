import { describe, it, expect } from 'vitest'
import {
  applyTitleBoost,
  applyShortChunkPenalty,
  applyRecencyBoost,
} from '@main/services/retrieval/heuristics'
import type { SearchHit } from '@main/db/database'

const baseHit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  chunk_id: 1,
  document_id: 1,
  document_title: 'Wochenbuch.pdf',
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  text: 'some passage text here that is long enough to escape the short penalty by a clear margin',
  score: 1.0,
  ...overrides,
})

describe('applyTitleBoost', () => {
  it('boosts when a non-stopword query term matches title', () => {
    const hits = [baseHit({ document_title: 'TudosaDenys_Wochenbuch.pdf' })]
    const out = applyTitleBoost(hits, 'fasse mein wochenbuch zusammen', 1.5)
    expect(out[0]!.score).toBeCloseTo(1.5)
  })

  it('skips stopword-only matches', () => {
    const hits = [baseHit({ document_title: 'A document' })]
    const out = applyTitleBoost(hits, 'der die das', 1.5)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('factor=1 is a no-op', () => {
    const hits = [baseHit({ document_title: 'Wochenbuch.pdf' })]
    const out = applyTitleBoost(hits, 'wochenbuch', 1.0)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('handles umlauts in title tokens', () => {
    const hits = [baseHit({ document_title: 'Föhrenwald.md' })]
    const out = applyTitleBoost(hits, 'föhrenwald notizen', 1.3)
    expect(out[0]!.score).toBeCloseTo(1.3)
  })
})

describe('applyShortChunkPenalty', () => {
  it('penalises chunks shorter than threshold', () => {
    const hits = [baseHit({ text: 'short', score: 1.0 })]
    const out = applyShortChunkPenalty(hits, 0.5, 200)
    expect(out[0]!.score).toBeCloseTo(0.5)
  })

  it('leaves long chunks untouched', () => {
    const hits = [baseHit({ text: 'a'.repeat(500), score: 1.0 })]
    const out = applyShortChunkPenalty(hits, 0.5, 200)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('factor=1 is a no-op', () => {
    const hits = [baseHit({ text: 'short', score: 1.0 })]
    const out = applyShortChunkPenalty(hits, 1.0, 200)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })
})

describe('applyRecencyBoost', () => {
  it('boosts hits added recently', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const hits = [baseHit({ added_at: nowSec, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.2, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.2)
  })

  it('leaves old hits untouched', () => {
    const longAgo = Math.floor(Date.now() / 1000) - 86_400
    const hits = [baseHit({ added_at: longAgo, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.2, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('factor=1 is a no-op even on recent docs', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const hits = [baseHit({ added_at: nowSec, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.0, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('null added_at means no boost', () => {
    const hits = [baseHit({ added_at: null, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.2, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })
})
