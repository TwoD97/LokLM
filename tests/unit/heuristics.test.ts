import { describe, it, expect } from 'vitest'
import {
  applyTitleBoost,
  applyShortChunkPenalty,
  applyRecencyBoost,
  applyLanguageMatchBoost,
} from '@main/services/retrieval/heuristics'
import type { SearchHit } from '@main/db/database'

const baseHit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  chunk_id: 1,
  document_id: 1,
  document_title: 'Wochenbuch.pdf',
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  heading_path: null,
  text: 'some passage text here that is long enough to escape the short penalty by a clear margin',
  score: 1.0,
  language: null,
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

describe('applyLanguageMatchBoost', () => {
  it('boosts hits whose language matches the response language', () => {
    const hits = [baseHit({ language: 'de', score: 1.0 })]
    const out = applyLanguageMatchBoost(hits, 'de', 1.2)
    expect(out[0]!.score).toBeCloseTo(1.2)
  })

  it('leaves mismatched-language hits untouched', () => {
    // English chunk + German response = no boost. We do NOT down-weight the
    // chunk; recall stays intact, the model just sees it slightly below
    // matching-language peers.
    const hits = [baseHit({ language: 'en', score: 1.0 })]
    const out = applyLanguageMatchBoost(hits, 'de', 1.2)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('skips chunks with null language (legacy / undetectable)', () => {
    const hits = [baseHit({ language: null, score: 1.0 })]
    const out = applyLanguageMatchBoost(hits, 'de', 1.2)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it("skips chunks tagged 'other'", () => {
    // 'other' means eld detected something outside DE/EN — we can't claim a
    // match either way, so no boost.
    const hits = [baseHit({ language: 'other', score: 1.0 })]
    const out = applyLanguageMatchBoost(hits, 'en', 1.2)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('is a no-op when responseLang is undefined', () => {
    // Caller (e.g. eval bridge, tests) didn't specify a target language —
    // we have no basis to prefer anything, so leave the pool alone.
    const hits = [baseHit({ language: 'de', score: 1.0 })]
    const out = applyLanguageMatchBoost(hits, undefined, 1.2)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('factor=1.0 is a no-op even on matching chunks', () => {
    const hits = [baseHit({ language: 'de', score: 1.0 })]
    const out = applyLanguageMatchBoost(hits, 'de', 1.0)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('applies independently per hit in a mixed pool', () => {
    const hits = [
      baseHit({ chunk_id: 1, language: 'de', score: 1.0 }),
      baseHit({ chunk_id: 2, language: 'en', score: 1.0 }),
      baseHit({ chunk_id: 3, language: null, score: 1.0 }),
      baseHit({ chunk_id: 4, language: 'other', score: 1.0 }),
    ]
    const out = applyLanguageMatchBoost(hits, 'de', 1.5)
    expect(out[0]!.score).toBeCloseTo(1.5)
    expect(out[1]!.score).toBeCloseTo(1.0)
    expect(out[2]!.score).toBeCloseTo(1.0)
    expect(out[3]!.score).toBeCloseTo(1.0)
  })
})
