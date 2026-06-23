import { describe, it, expect } from 'vitest'
import type { SearchHit } from '@main/db/types'
import {
  extractCodeIdentifiers,
  isCodeHit,
  applyCodeSymbolBoost,
  applyCodeFilenameBoost,
  ensureCodeShare,
  dynamicScoreCutCount,
} from '@main/services/retrieval/heuristics'

// Minimal SearchHit factory — only the fields the code heuristics read.
function hit(p: Partial<SearchHit> & { score: number; chunk_id?: number }): SearchHit {
  return {
    chunk_id: p.chunk_id ?? 1,
    document_id: p.document_id ?? 1,
    document_title: p.document_title ?? 'doc',
    ordinal: 0,
    page_from: null,
    page_to: null,
    heading_path: p.heading_path ?? null,
    text: p.text ?? '',
    score: p.score,
    language: null,
  }
}

describe('extractCodeIdentifiers', () => {
  it('extracts camelCase / PascalCase / snake_case identifiers', () => {
    expect(extractCodeIdentifiers('how does setPreferredKind work?')).toContain('setpreferredkind')
    expect(extractCodeIdentifiers('explain the EmbeddingService class')).toContain(
      'embeddingservice',
    )
    expect(extractCodeIdentifiers('what is ensure_backend')).toContain('ensure_backend')
  })

  it('splits a dotted path into its parts (and keeps the whole)', () => {
    const ids = extractCodeIdentifiers('look at planner.refreshIfStale here')
    expect(ids).toEqual(
      expect.arrayContaining(['planner.refreshifstale', 'planner', 'refreshifstale']),
    )
  })

  it('ignores plain natural-language words (no code shape)', () => {
    // no camelCase / underscore / dot → nothing should be treated as an identifier
    expect(extractCodeIdentifiers('how does authentication work in the app')).toEqual([])
  })
})

describe('isCodeHit', () => {
  it('classifies a code-file breadcrumb as code', () => {
    expect(
      isCodeHit(hit({ heading_path: ['EmbeddingService.ts', 'setPreferredKind'], score: 1 })),
    ).toBe(true)
  })
  it('classifies a markdown-heading breadcrumb as not-code', () => {
    expect(isCodeHit(hit({ heading_path: ['Installation'], score: 1 }))).toBe(false)
    expect(isCodeHit(hit({ heading_path: ['README.md'], score: 1 }))).toBe(false)
  })
  it('treats a missing breadcrumb as not-code', () => {
    expect(isCodeHit(hit({ heading_path: null, score: 1 }))).toBe(false)
  })
})

describe('applyCodeSymbolBoost', () => {
  const q = 'how does setPreferredKind work?'

  it('boosts a hit whose breadcrumb symbol matches a query identifier', () => {
    const out = applyCodeSymbolBoost(
      [
        hit({
          heading_path: ['EmbeddingService.ts', 'setPreferredKind'],
          text: 'no def here',
          score: 1,
        }),
      ],
      q,
      2.0,
      1.5,
    )
    expect(out[0]!.score).toBeCloseTo(2.0)
  })

  it('adds the definition factor when the chunk text actually defines the identifier (method form)', () => {
    const out = applyCodeSymbolBoost(
      [
        hit({
          heading_path: ['EmbeddingService.ts', 'EmbeddingService'], // enclosing class, not the method
          text: '  async setPreferredKind(kind: Kind): Promise<void> {\n    this.kind = kind\n  }',
          score: 1,
        }),
      ],
      q,
      2.0,
      1.5,
    )
    // symbol breadcrumb is the class (no symbol match) but the text DEFINES the method → defineFactor only
    expect(out[0]!.score).toBeCloseTo(1.5)
  })

  it('leaves non-matching and non-code hits untouched', () => {
    const out = applyCodeSymbolBoost(
      [
        hit({ heading_path: ['Other.ts', 'unrelated'], text: 'x', score: 1, chunk_id: 1 }),
        hit({
          heading_path: null,
          text: 'setPreferredKind mentioned in prose',
          score: 1,
          chunk_id: 2,
        }),
      ],
      q,
      2.0,
      1.5,
    )
    expect(out[0]!.score).toBeCloseTo(1)
    expect(out[1]!.score).toBeCloseTo(1)
  })
})

describe('applyCodeFilenameBoost', () => {
  it('boosts a hit from a file the query names', () => {
    const out = applyCodeFilenameBoost(
      [hit({ heading_path: ['RetrievalService.ts', 'search'], score: 1 })],
      'walk me through RetrievalService',
      1.3,
    )
    expect(out[0]!.score).toBeCloseTo(1.3)
  })
  it('does not boost unrelated files', () => {
    const out = applyCodeFilenameBoost(
      [hit({ heading_path: ['EmbeddingService.ts', 'embed'], score: 1 })],
      'walk me through RetrievalService',
      1.3,
    )
    expect(out[0]!.score).toBeCloseTo(1)
  })
})

describe('ensureCodeShare', () => {
  const code = (id: number, s: number) =>
    hit({ chunk_id: id, heading_path: ['a.ts', 'fn'], text: 'code', score: s })
  const doc = (id: number, s: number) =>
    hit({ chunk_id: id, heading_path: ['Intro'], text: 'prose', score: s })

  it('injects code hits when the top-K is code-starved', () => {
    const pool = [doc(1, 0.9), doc(2, 0.8), doc(3, 0.7), code(4, 0.6), code(5, 0.5)]
    const topK = [doc(1, 0.9), doc(2, 0.8), doc(3, 0.7)] // diversify picked all docs
    const out = ensureCodeShare(topK, pool, 3, 2)
    expect(out).toHaveLength(3)
    expect(out.filter(isCodeHit)).toHaveLength(2) // guaranteed ≥2 code
    expect(out.some((h) => h.chunk_id === 1)).toBe(true) // best doc kept
  })

  it('is a no-op when the top-K already has enough code', () => {
    const topK = [code(1, 0.9), doc(2, 0.8), code(3, 0.7)]
    const out = ensureCodeShare(topK, topK, 3, 2)
    expect(out).toEqual(topK)
  })

  it('does not invent code hits that are not in the pool', () => {
    const pool = [doc(1, 0.9), doc(2, 0.8)]
    const topK = [doc(1, 0.9), doc(2, 0.8)]
    const out = ensureCodeShare(topK, pool, 2, 2)
    expect(out).toEqual(topK) // nothing to inject
  })
})

describe('applyCodeFilenameBoost — substring mode (fix #2)', () => {
  const codeHit = (stem: string, score: number) =>
    hit({ heading_path: [`src/main/services/auth/${stem}.ts`], text: 'x', score })

  it('exact mode: a lay word does NOT boost a compound filename', () => {
    const out = applyCodeFilenameBoost(
      [codeHit('AuthService', 1)],
      'how does the auth class work',
      1.3,
      'exact',
    )
    expect(out[0]!.score).toBe(1) // "auth" !== stem "authservice"
  })

  it('substring mode: "auth" boosts AuthService.ts', () => {
    const out = applyCodeFilenameBoost(
      [codeHit('AuthService', 1)],
      'how does the auth class work',
      1.3,
      'substring',
    )
    expect(out[0]!.score).toBeCloseTo(1.3)
  })

  it('substring mode ignores short fragments (<4 chars)', () => {
    // "db" is 2 chars → must not boost WorkspaceDb just because the stem contains it
    const out = applyCodeFilenameBoost([codeHit('WorkspaceDb', 1)], 'open the db', 1.3, 'substring')
    expect(out[0]!.score).toBe(1)
  })

  it('never boosts doc/prose chunks', () => {
    const prose = hit({ heading_path: ['Authentication'], text: 'auth prose', score: 1 })
    const out = applyCodeFilenameBoost([prose], 'auth login', 1.3, 'substring')
    expect(out[0]!.score).toBe(1)
  })
})

describe('dynamicScoreCutCount (fix #3)', () => {
  const s = (...scores: number[]) => scores.map((score, i) => hit({ chunk_id: i, score }))

  it('cuts at a big relative score drop', () => {
    // 3 strong then a cliff → keep 3 (clamped within [2, maxK])
    expect(dynamicScoreCutCount(s(5, 4.8, 4.5, 0.2, 0.1), 2, 10)).toBe(3)
  })

  it('keeps up to maxK when scores stay flat', () => {
    expect(dynamicScoreCutCount(s(2, 2, 2, 2, 2, 2), 2, 4)).toBe(4)
  })

  it('never returns fewer than minK or more than available', () => {
    expect(dynamicScoreCutCount(s(9, 0.01), 2, 10)).toBe(2) // cliff at 2 but minK floor
    expect(dynamicScoreCutCount(s(1), 2, 10)).toBe(1) // only one hit
  })
})
