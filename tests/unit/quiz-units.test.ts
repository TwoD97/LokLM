import { describe, it, expect } from 'vitest'
import {
  buildUnits,
  selectUnits,
  planQuiz,
  UNIT_MAX_TOKENS,
  UNIT_MIN_TOKENS,
  TWO_QUESTION_THRESHOLD,
} from '../../src/main/services/quiz/units'
import type { QuizUnit } from '../../src/main/services/quiz/units'
import type { ChunkRow } from '../../src/main/db/database'

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

function unitTokens(units: QuizUnit[]): number[] {
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
    expect(units).toHaveLength(1)
    expect(units[0]!.tokens).toBe(600)
    expect(units[0]!.chunks).toHaveLength(3)
  })

  it('starts a new unit when the top-level section changes', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 400, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 400, heading_path: ['Ch1', 'Sub'] }),
        chunk({ ordinal: 2, token_count: 400, heading_path: ['Ch2'] }),
      ]),
    ])
    expect(unitTokens(units)).toEqual([800, 400])
  })

  it('does not treat null heading paths as section boundaries', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 400, heading_path: null }),
        chunk({ ordinal: 1, token_count: 400, heading_path: null }),
        chunk({ ordinal: 2, token_count: 400, heading_path: null }),
      ]),
    ])
    expect(unitTokens(units)).toEqual([1200])
  })

  it('splits an oversized section at UNIT_MAX_TOKENS', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 700, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 700, heading_path: ['Ch1'] }),
        chunk({ ordinal: 2, token_count: 700, heading_path: ['Ch1'] }),
      ]),
    ])
    // 700+700 = 1400 fits; +700 would exceed UNIT_MAX_TOKENS=1800.
    expect(UNIT_MAX_TOKENS).toBe(1800)
    expect(unitTokens(units)).toEqual([1400, 700])
  })

  it('absorbs a trailing unit smaller than UNIT_MIN_TOKENS into the previous unit', () => {
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 600, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 100, heading_path: ['Ch2'] }),
      ]),
    ])
    expect(UNIT_MIN_TOKENS).toBe(250)
    expect(unitTokens(units)).toEqual([700])
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
    const units = buildUnits([doc([chunk({ ordinal: 0, token_count: 120 })])])
    expect(unitTokens(units)).toEqual([120])
  })

  it('assigns quota 2 at TWO_QUESTION_THRESHOLD tokens and above, else 1', () => {
    expect(TWO_QUESTION_THRESHOLD).toBe(900)
    const units = buildUnits([
      doc([
        chunk({ ordinal: 0, token_count: 899, heading_path: ['Ch1'] }),
        chunk({ ordinal: 1, token_count: 900, heading_path: ['Ch2'] }),
      ]),
    ])
    expect(units.map((u) => u.quota)).toEqual([1, 2])
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
})

describe('selectUnits', () => {
  function unitOf(tokens: number, quota: 1 | 2, id: number): QuizUnit {
    return {
      docId: 1,
      docTitle: 'Doc',
      chunks: [chunk({ id, token_count: tokens })],
      tokens,
      quota,
      title: `U${id}`,
    }
  }

  it('returns all units unchanged when the cap covers the total quota', () => {
    const units = [unitOf(500, 1, 1), unitOf(500, 1, 2)]
    expect(selectUnits(units, 30)).toEqual(units)
  })

  it('picks the densest unit per stride window, preserving order', () => {
    const tokens = [300, 400, 500, 300, 300, 600, 700, 300, 300, 800]
    const units = tokens.map((t, i) => unitOf(t, 1, i))
    const picked = selectUnits(units, 5)
    expect(picked.map((u) => u.chunks[0]!.id)).toEqual([1, 2, 5, 6, 9])
  })

  it('demotes quota-2 picks in ascending token order until the cap is met', () => {
    const units = [unitOf(1000, 2, 1), unitOf(1500, 2, 2), unitOf(1200, 2, 3)]
    const picked = selectUnits(units, 5)
    expect(picked.map((u) => u.quota)).toEqual([1, 2, 2])
  })

  it('is deterministic for repeated calls', () => {
    const units = Array.from({ length: 20 }, (_, i) => unitOf(300 + (i % 7) * 100, 1, i))
    const a = selectUnits(units, 8)
    const b = selectUnits(units, 8)
    expect(a).toEqual(b)
  })
})

describe('planQuiz', () => {
  it('derives the question count from unit quotas when under the cap', () => {
    const plan = planQuiz(
      [
        doc([
          chunk({ ordinal: 0, token_count: 1000, heading_path: ['Ch1'] }),
          chunk({ ordinal: 1, token_count: 400, heading_path: ['Ch2'] }),
        ]),
      ],
      30,
    )
    // 1000 tokens → quota 2, 400 tokens → quota 1.
    expect(plan.questionCount).toBe(3)
    expect(plan.units).toHaveLength(2)
  })

  it('never exceeds the cap', () => {
    const docs = [
      doc(
        Array.from({ length: 40 }, (_, i) =>
          chunk({ ordinal: i, token_count: 1000, heading_path: [`Ch${i}`] }),
        ),
      ),
    ]
    const plan = planQuiz(docs, 30)
    expect(plan.questionCount).toBeLessThanOrEqual(30)
    expect(plan.questionCount).toBeGreaterThan(0)
  })

  it('returns an empty plan for empty input', () => {
    expect(planQuiz([], 30)).toEqual({ units: [], questionCount: 0 })
  })
})
