import { describe, expect, it } from 'vitest'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import { CONTEXT_PACK_MARGIN_TOKENS, packHitsToBudget } from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

const hit = (id: number, text = 'Supported evidence. '.repeat(25)): RetrievalHit => ({
  chunk_id: id,
  document_id: id,
  document_title: `Source ${id}`,
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  heading_path: ['Results'],
  language: 'en',
  text,
  score: 1,
  origin: 'primary',
})

describe('production answer context allocation', () => {
  for (const contextTokens of [4096, 8192]) {
    for (const language of ['de', 'en'] as const) {
      it(`fits complete ${language} prompt, history, pins and output in ${contextTokens}`, () => {
        const history = Array.from({ length: 60 }, (_, i) => ({
          role: i % 2 ? ('assistant' as const) : ('user' as const),
          content: `Turn ${i}: ` + 'Prior conversation. '.repeat(100),
        }))
        const pinned = hit(1)
        const plan = planAnswerContext({
          contextTokens,
          language,
          question: 'Compare the supported results.',
          history,
          pinnedGroups: [[pinned]],
          hits: [pinned, hit(2), hit(3)],
        })
        expect(plan.fits).toBe(true)
        expect(plan.promptTokens + plan.maxTokens + CONTEXT_PACK_MARGIN_TOKENS).toBeLessThanOrEqual(
          contextTokens,
        )
        expect(plan.hits.some((h) => h.chunk_id === 2)).toBe(true)
        const supplied = [...plan.pinnedHits, ...plan.hits]
        expect(supplied.filter((h) => h.chunk_id === 1)).toHaveLength(1)
        expect(plan.history.length).toBeLessThan(history.length)
        expect(plan.history.at(-1)?.content).toContain('Turn 59:')
        expect(history[0]?.content.length).toBeGreaterThan(1500)
      })
    }
  }

  it('spends unused pinned capacity on retrieved evidence', () => {
    const input = {
      contextTokens: 4096,
      language: 'en' as const,
      question: 'What is supported?',
      hits: Array.from({ length: 8 }, (_, i) => hit(i + 2)),
    }
    const ordinary = planAnswerContext(input)
    const unusablePin = planAnswerContext({
      ...input,
      pinnedGroups: [[hit(1, 'x'.repeat(100_000))]],
    })
    expect(unusablePin.pinnedHits).toHaveLength(0)
    expect(unusablePin.hits).toEqual(ordinary.hits)
  })

  it('keeps fitting pinned passages when individual fair shares are too small', () => {
    const pinnedGroups = Array.from({ length: 4 }, (_, i) => [hit(i + 1, 'X'.repeat(2000))])
    const plan = planAnswerContext({
      contextTokens: 4096,
      language: 'en',
      question: 'What do these documents say?',
      hits: [],
      pinnedGroups,
    })
    expect(plan.pinnedHits.length).toBeGreaterThan(0)
    expect(plan.pinnedHits.length).toBeLessThan(4)
    expect(plan.fits).toBe(true)
    expect(plan.promptTokens + plan.maxTokens + CONTEXT_PACK_MARGIN_TOKENS).toBeLessThanOrEqual(
      4096,
    )
  })

  it('keeps both primaries ahead of a large neighbor without altering source text', () => {
    const first = hit(1, 'A'.repeat(350))
    const neighbor = { ...hit(2, 'B'.repeat(5000)), origin: 'neighbour' as const }
    const second = hit(3, 'C'.repeat(350))
    const packed = packHitsToBudget([first, neighbor, second], 300, 'en')
    expect(packed).toEqual([first, second])
    expect(packed[0]).toBe(first)
  })

  it('does not grant an oversized sole passage an exception', () => {
    const plan = planAnswerContext({
      contextTokens: 4096,
      language: 'de',
      question: 'Was steht hier?',
      hits: [hit(1, 'x'.repeat(80_000))],
    })
    expect(plan.fits).toBe(true)
    expect(plan.hits).toHaveLength(0)
  })

  it('rejects a question that alone exceeds the window', () => {
    const plan = planAnswerContext({
      contextTokens: 4096,
      language: 'en',
      question: 'x'.repeat(60_000),
      hits: [hit(1)],
    })
    expect(plan.fits).toBe(false)
    expect(plan.hits).toHaveLength(0)
  })

  it('uses original excerpts when a cached overview would crowd them out', () => {
    const plan = planAnswerContext({
      contextTokens: 4096,
      language: 'en',
      question: 'Summarize the results.',
      hits: [hit(1)],
      summary: { title: 'Results', summary: 'Derived summary. '.repeat(5000) },
    })
    expect(plan.summaryOmitted).toBe(true)
    expect(plan.contextPreamble).toBeUndefined()
    expect(plan.hits).toHaveLength(1)
    expect(plan.fits).toBe(true)
  })

  it('bounds code prompts with long citation headers too', () => {
    const plan = planAnswerContext({
      contextTokens: 4096,
      language: 'de',
      codebase: true,
      question: 'How does this method work?',
      hits: [hit(1), { ...hit(2), heading_path: ['long/path/'.repeat(100)] }],
    })
    expect(plan.fits).toBe(true)
    expect(plan.promptTokens + plan.maxTokens + CONTEXT_PACK_MARGIN_TOKENS).toBeLessThanOrEqual(
      4096,
    )
    expect(plan.hits[0]?.chunk_id).toBe(1)
  })
})
