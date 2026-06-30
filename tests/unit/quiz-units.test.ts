import { describe, it, expect } from 'vitest'
import {
  buildUnits,
  planQuiz,
  unitMaxTokens,
  UNIT_TOKENS_MIN,
  UNIT_TOKENS_MAX,
  UNIT_MIN_TOKENS,
} from '../../src/main/services/quiz/units'
import type { ChunkRow } from '../../src/main/db/types'

let nextId = 1

function chunk(partial: Partial<ChunkRow> = {}): ChunkRow {
  const tokens = partial.token_count === undefined ? 100 : partial.token_count
  return {
    id: partial.id ?? nextId++,
    document_id: partial.document_id ?? 1,
    ordinal: partial.ordinal ?? 0,
    text: partial.text ?? 'word '.repeat(tokens ?? 100),
    token_count: tokens,
    page_from: partial.page_from ?? null,
    page_to: partial.page_to ?? null,
    heading_path: partial.heading_path ?? null,
    language: partial.language ?? null,
  }
}

function doc(
  chunks: ChunkRow[],
  overrides: { docId?: number; docTitle?: string } = {},
): { docId: number; docTitle: string; chunks: ChunkRow[] } {
  return { docId: overrides.docId ?? 1, docTitle: overrides.docTitle ?? 'Doc', chunks }
}

function unitTokens(units: ReturnType<typeof buildUnits>): number[] {
  return units.map((u) => u.tokens)
}

describe('buildUnits', () => {
  it('packs consecutive chunks of the same top-level section into one unit', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 200, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 200, heading_path: ['Ch1', 'Sub A'] }),
        chunk({ ordinal: 2, token_count: 200, heading_path: ['Ch1', 'Sub B'] }),
      ]),
    ])
    // 200+200+200 = 600 packs exactly to UNIT_MAX_TOKENS (the >cap check is
    // strict, so 600 still fits in one unit).
    expect(units).toHaveLength(1)
    expect(units[0]!.tokens).toBe(600)
    expect(units[0]!.chunks).toHaveLength(3)
  })

  it('starts a new unit when the top-level section changes', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 200, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 200, heading_path: ['Ch1', 'Sub'] }),
        chunk({ ordinal: 2, token_count: 200, heading_path: ['Ch2'] }),
      ]),
    ])
    expect(unitTokens(units)).toEqual([400, 200])
  })

  it('does not treat null heading paths as section boundaries', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 200, heading_path: null }),
        chunk({ ordinal: 1, token_count: 200, heading_path: null }),
        chunk({ ordinal: 2, token_count: 200, heading_path: null }),
      ]),
    ])
    // No section split: the three null-heading chunks pack by size alone into
    // the single UNIT_MAX_TOKENS-sized unit.
    expect(unitTokens(units)).toEqual([600])
  })

  it('splits an oversized section at the (size-derived) unit budget', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 300, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 300, heading_path: ['Ch1'] }),
        chunk({ ordinal: 2, token_count: 300, heading_path: ['Ch1'] }),
      ]),
    ])
    // 900-token doc ⇒ budget stays near the UNIT_TOKENS_MIN floor (well under
    // 900), so 300+300 fits but the third 300-token chunk starts a new unit.
    expect(unitMaxTokens(900)).toBeGreaterThanOrEqual(600)
    expect(unitMaxTokens(900)).toBeLessThan(900)
    expect(unitTokens(units)).toEqual([600, 300])
  })

  it('absorbs a trailing unit smaller than UNIT_MIN_TOKENS into the previous unit', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 500, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 80, heading_path: ['Ch2'] }),
      ]),
    ])
    expect(UNIT_MIN_TOKENS).toBe(120)
    expect(unitTokens(units)).toEqual([580])
  })

  it('absorbs a tiny leading unit into the next unit', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 100, heading_path: ['Cover'] }),
        chunk({ ordinal: 1, token_count: 600, heading_path: ['Ch1'] }),
      ]),
    ])
    expect(unitTokens(units)).toEqual([700])
  })

  it('keeps a single tiny unit when there is nothing to merge into', () => {
    const units = buildUnits([doc([chunk({ ordinal: 0, token_count: 80 })])])
    expect(unitTokens(units)).toEqual([80])
  })

  it('titles a unit with the last heading element of its largest chunk', () => {
    const units = buildUnits([
      doc([chunk({ ordinal: 0, token_count: 400, heading_path: ['Ch 3', 'Functions'] })]),
    ])
    expect(units[0]!.title).toBe('Functions')
  })

  it('falls back to the document title when there is no heading path', () => {
    const units = buildUnits([
      doc([chunk({ ordinal: 0, token_count: 400, heading_path: null })], {
        docTitle: 'Lecture 4',
      }),
    ])
    expect(units[0]!.title).toBe('Lecture 4')
  })

  it('never merges units across documents', () => {
    const units = buildUnits([
      doc([chunk({ ordinal: 0, token_count: 100, document_id: 1 })], { docId: 1 }),
      doc([chunk({ ordinal: 0, token_count: 100, document_id: 2 })], { docId: 2 }),
    ])
    expect(units).toHaveLength(2)
    expect(units.map((u) => u.docId)).toEqual([1, 2])
  })

  it('skips chunks with empty text', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 400 }),
        chunk({ ordinal: 1, token_count: 400, text: '   ' }),
      ]),
    ])
    expect(units).toHaveLength(1)
    expect(units[0]!.chunks).toHaveLength(1)
  })

  it('estimates tokens from text length when token_count is null', () => {
    const units = buildUnits([
      doc([chunk({ ordinal: 0, token_count: null, text: 'x'.repeat(3500) })]),
    ])
    expect(units[0]!.tokens).toBe(1000)
  })

  it('does not expose any per-unit question quota — the model decides coverage', () => {
    const units = buildUnits([doc([chunk({ ordinal: 0, token_count: 120 })])])
    expect('quota' in units[0]!).toBe(false)
  })
})

describe('planQuiz', () => {
  it('returns every unit — no cap, no sampling', () => {
    const docs = [
      doc(
        Array.from({ length: 40 }, (_, i) =>
          chunk({ ordinal: i, token_count: 1000, heading_path: [`Ch${i}`] }),
        ),
      ),
    ]
    const plan = planQuiz(docs)
    expect(plan.units).toHaveLength(40)
  })

  it('returns an empty plan for empty input', () => {
    expect(planQuiz([])).toEqual({ units: [] })
  })
})

describe('unitMaxTokens', () => {
  it('floors at UNIT_TOKENS_MIN for short documents', () => {
    expect(unitMaxTokens(0)).toBe(UNIT_TOKENS_MIN)
    expect(unitMaxTokens(500)).toBeGreaterThanOrEqual(UNIT_TOKENS_MIN)
    expect(unitMaxTokens(500)).toBeLessThan(UNIT_TOKENS_MIN + 50)
  })

  it('grows with document size but caps at UNIT_TOKENS_MAX', () => {
    expect(unitMaxTokens(20_000)).toBeGreaterThan(UNIT_TOKENS_MIN)
    expect(unitMaxTokens(20_000)).toBeLessThanOrEqual(UNIT_TOKENS_MAX)
    expect(unitMaxTokens(1_000_000)).toBe(UNIT_TOKENS_MAX)
  })

  it('is monotonic in document size', () => {
    expect(unitMaxTokens(2_000)).toBeLessThanOrEqual(unitMaxTokens(8_000))
    expect(unitMaxTokens(8_000)).toBeLessThanOrEqual(unitMaxTokens(40_000))
  })

  it('uses larger units for a big document than a small one (fewer LLM calls)', () => {
    // Same 12k tokens of content, one as a single big doc, conceptually splits
    // into fewer units than if it were a 1k-token doc's budget.
    expect(unitMaxTokens(12_000)).toBeGreaterThan(unitMaxTokens(1_000))
  })
})
