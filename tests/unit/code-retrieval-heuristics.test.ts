import { describe, it, expect } from 'vitest'
import type { SearchHit } from '@main/db/types'
import {
  extractCodeIdentifiers,
  isCodeHit,
  applyCodeSymbolBoost,
  applyCodeFilenameBoost,
  ensureCodeShare,
  dynamicScoreCutCount,
  nonStopwordTokens,
  expandGermanCodeTerms,
  detectTestIntent,
  applyRoleBoost,
  detectCodeIntent,
  detectDocsIntent,
  applyTrackPreference,
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

describe('German query heuristics', () => {
  it('drops German question/function words but keeps domain nouns', () => {
    const toks = nonStopwordTokens('wie funktioniert die authentifizierung klasse')
    expect(toks).toContain('authentifizierung')
    expect(toks).toContain('klasse') // a code noun — must NOT be a stopword
    expect(toks).not.toContain('wie')
    expect(toks).not.toContain('funktioniert')
    expect(toks).not.toContain('die')
  })

  it('expandGermanCodeTerms bridges German nouns to english code terms', () => {
    expect(expandGermanCodeTerms('wie funktioniert die authentifizierung')).toEqual(
      expect.arrayContaining(['auth', 'authentication']),
    )
    expect(expandGermanCodeTerms('wo werden die einstellungen gespeichert')).toContain('settings')
    expect(expandGermanCodeTerms('zeig mir die datenbank-abfrage')).toEqual(
      expect.arrayContaining(['database', 'query']),
    )
    expect(expandGermanCodeTerms('how does auth work')).toEqual([]) // english → no expansion
  })

  it('a German query boosts the matching english filename via the bridge', () => {
    const auth = hit({
      heading_path: ['src/main/services/auth/AuthService.ts'],
      text: 'x',
      score: 1,
    })
    // "authentifizierung" → "auth" → substring of stem "authservice"
    const out = applyCodeFilenameBoost(
      [auth],
      'wie funktioniert die authentifizierung',
      1.3,
      'substring',
    )
    expect(out[0]!.score).toBeCloseTo(1.3)
  })
})

describe('detectTestIntent (EN + DE)', () => {
  it('detects test questions in English and German', () => {
    expect(detectTestIntent('show me the test for AuthService')).toBe(true)
    expect(detectTestIntent('what does the spec cover')).toBe(true)
    expect(detectTestIntent('wie wird der login getestet')).toBe(true)
    expect(detectTestIntent('zeig mir den testfall für die anmeldung')).toBe(true)
    expect(detectTestIntent('wie ist die abdeckung')).toBe(true)
  })
  it('does not fire on plain implementation questions', () => {
    expect(detectTestIntent('how does the auth class work')).toBe(false)
    expect(detectTestIntent('wie funktioniert die anmeldung')).toBe(false)
  })
})

describe('applyRoleBoost', () => {
  const src = (score: number) =>
    hit({
      heading_path: ['src/main/services/auth/AuthService.ts', 'AuthService'],
      text: 'x',
      score,
    })
  const test = (score: number) =>
    hit({ heading_path: ['tests/integration/auth-flow.test.ts'], text: 'x', score })
  const opts = { nonSourcePenalty: 0.5, testBoost: 1.5 }

  it('source-intent query penalizes test/eval code, leaves source', () => {
    const out = applyRoleBoost([src(1), test(1)], 'how does the auth class work', opts)
    expect(out[0]!.score).toBe(1) // source untouched
    expect(out[1]!.score).toBeCloseTo(0.5) // test pushed down
  })

  it('test-intent query lifts test AND demotes the implementation (code is logic, test is test)', () => {
    const out = applyRoleBoost([src(1), test(1)], 'show me the test for auth', opts)
    expect(out[0]!.score).toBeCloseTo(0.5) // source demoted so the test wins
    expect(out[1]!.score).toBeCloseTo(1.5) // test lifted → 3× the source
  })

  it('never touches prose/doc hits', () => {
    const doc = hit({ heading_path: ['docs/handbook/auth.md'], text: 'auth prose', score: 1 })
    const out = applyRoleBoost([doc], 'how does the auth class work', opts)
    expect(out[0]!.score).toBe(1)
  })
})

describe('code-over-docs preference (fix #6)', () => {
  const code = (s: number) =>
    hit({
      heading_path: ['src/main/services/auth/AuthService.ts', 'AuthService'],
      text: 'x',
      score: s,
    })
  const doc = (s: number) =>
    hit({ heading_path: ['docs/handbook/auth.md'], text: 'auth prose', score: s })

  it('detectCodeIntent fires on code nouns, identifiers, and how-does (EN+DE)', () => {
    expect(detectCodeIntent('how does the auth class work')).toBe(true)
    expect(detectCodeIntent('wie funktioniert die authentifizierungs-klasse')).toBe(true)
    expect(detectCodeIntent('zeig mir die Login funktion')).toBe(true)
    expect(detectCodeIntent('AuthService')).toBe(true) // identifier
    expect(detectCodeIntent('wo wird das passwort gespeichert')).toBe(true)
  })

  it('detectDocsIntent fires only on explicit doc/concept requests', () => {
    expect(detectDocsIntent('gib mir einen überblick über das projekt')).toBe(true)
    expect(detectDocsIntent('was steht im handbuch')).toBe(true)
    expect(detectDocsIntent('explain the concept')).toBe(true)
    expect(detectDocsIntent('how does the auth class work')).toBe(false)
  })

  it('penalizes docs on a code-intent query, lifting code above prose', () => {
    const out = applyTrackPreference([doc(1), code(0.9)], 'how does the auth class work', {
      docPenalty: 0.5,
    })
    expect(out[0]!.score).toBeCloseTo(0.5) // doc pushed down
    expect(out[1]!.score).toBe(0.9) // code untouched → now ranks above the doc
  })

  it('leaves docs alone for an explicit docs/concept request', () => {
    const out = applyTrackPreference(
      [doc(1), code(0.9)],
      'gib mir einen überblick übers handbuch',
      {
        docPenalty: 0.5,
      },
    )
    expect(out[0]!.score).toBe(1) // docs compete normally
  })

  it('leaves docs alone for a generic (non-code, non-docs) query', () => {
    const out = applyTrackPreference([doc(1)], 'tell me about privacy', { docPenalty: 0.5 })
    expect(out[0]!.score).toBe(1)
  })
})
