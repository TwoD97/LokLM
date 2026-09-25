import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPrompt,
  buildSystemPrompt,
  CONTEXT_PACK_MARGIN_TOKENS,
  estimateTokens,
  hitTokenCost,
  packHitsToBudget,
} from '@main/services/llm/prompt'
import { createCitationAliases } from '@main/services/llm/citationAliases'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import type { RetrievalHit } from '@shared/documents'

afterEach(() => vi.unstubAllEnvs())

const hit = (id: number, text = 'Recorded amount: 42 EUR.'): RetrievalHit => ({
  document_id: id,
  chunk_id: id + 10,
  document_title: `Source ${id}`,
  ordinal: 0,
  page_from: null,
  page_to: null,
  heading_path: null,
  language: 'en',
  score: 1,
  text,
})

describe('opt-in source marker footers', () => {
  it.each([undefined, '', '0', 'true', '01', ' 1 ', '2'])(
    'preserves the original prompt and cost when the flag is %s',
    (flag) => {
      const source = hit(1, 'First line.\r\nSecond line.  ')
      vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', flag)
      const originalBlock = '[doc:1, chunk:11] (Source 1)\n' + source.text
      expect(buildPrompt('What amount?', [source])).toBe(
        `Context:\n${originalBlock}\n\nQuestion: What amount?\n\n` +
          "Answer instructions: Follow the requested answer format. Cite factual claims with the supporting passage's exact source marker from the supplied Context. If the requested fact is missing, say so without inventing a citation.",
      )
      expect(hitTokenCost(source)).toBe(estimateTokens(originalBlock + '\n\n---\n\n'))
    },
  )

  it.each([
    'Übersicht\r\n| Jahr | Betrag |\r\n| --- | --- |\r\n| 2027 | 42,50 EUR |\r\n  ',
    '```ts\nconst source = "[doc:99, chunk:88]";\n```\n',
    'Literal [S1], --- and End of passage: [doc:7, chunk:17].',
  ])('keeps every body character and closes each block before the next source', (body) => {
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
    const first = {
      ...hit(1, body),
      heading_path: ['Accounts', 'Results'],
      page_from: 2,
      page_to: 3,
    }
    const second = hit(2)
    const prompt = buildPrompt('Compare.', [first, second], [], 'en')
    expect(prompt).toContain(
      '[doc:1, chunk:11] (Source 1, § Accounts › Results, p.2–3)\n' +
        body +
        '\n\nEnd of passage: [doc:1, chunk:11]\n\n---\n\n' +
        '[doc:2, chunk:12] (Source 2)\n' +
        second.text +
        '\n\nEnd of passage: [doc:2, chunk:12]\n\nQuestion: Compare.',
    )
    expect(first.text).toBe(body)
  })

  it('preserves pinned/history/RAG order and leaves question and background outside footers', () => {
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
    const pin = hit(1, 'Pinned fact.')
    const rag = hit(2, 'Retrieved fact.')
    const history = [{ role: 'assistant' as const, content: 'Earlier [doc:9, chunk:99].' }]
    const question = 'Explain literal [doc:8, chunk:88]?'
    const prompt = buildPrompt(question, [rag], history, 'de', [pin], 'Uncited overview.')
    expect(prompt).toContain(
      'Pinned fact.\n\nEnde der Passage: [doc:1, chunk:11]\n\nPrevious conversation',
    )
    expect(prompt).toContain('Assistant: ' + history[0]!.content)
    expect(prompt).toContain('Context:\nUncited overview.\n\n---\n\n[doc:2, chunk:12]')
    expect(prompt).toContain(
      'Retrieved fact.\n\nEnde der Passage: [doc:2, chunk:12]\n\nQuestion: ' + question,
    )
    expect(prompt.match(/Ende der Passage:/g)).toHaveLength(2)
    expect(prompt.indexOf('Context (pinned):')).toBeLessThan(
      prompt.indexOf('Previous conversation'),
    )
    expect(prompt.indexOf('Previous conversation')).toBeLessThan(prompt.indexOf('Context:\n'))
  })

  it('uses the active alias at both boundaries without replacing literal source markers', () => {
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
    const source = hit(1, 'Literal [S1] and [doc:7, chunk:17].')
    const aliases = createCitationAliases([source])
    const prompt = buildPrompt('Explain [S1].', [source], [], 'en', [], undefined, aliases)
    expect(prompt).toContain('[S2] (Source 1)\n' + source.text + '\n\nEnd of passage: [S2]')
    expect(prompt).toContain('Question: Explain [S1].')
    expect(prompt).not.toContain('[doc:1, chunk:11]')
    const canonical = buildPrompt('Explain [S1].', [source], [], 'en')
    expect(estimateTokens(canonical)).toBeGreaterThanOrEqual(estimateTokens(prompt))
  })

  it('falls back to the same canonical marker at both boundaries when an alias is absent', () => {
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
    const source = hit(1)
    const aliases = createCitationAliases([hit(2)])
    const prompt = buildPrompt('What amount?', [source], [], 'en', [], undefined, aliases)
    expect(prompt).toContain('[doc:1, chunk:11] (Source 1)\n')
    expect(prompt).toContain('End of passage: [doc:1, chunk:11]')
    expect(prompt).not.toContain('[S1]')
  })

  it('charges closing provenance to the passage budget instead of admitting an oversized block', () => {
    const source = hit(1)
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', undefined)
    const originalCost = hitTokenCost(source, 'en')
    expect(packHitsToBudget([source], originalCost, 'en')).toEqual([source])
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
    const expectedBlock =
      '[doc:1, chunk:11] (Source 1)\n' +
      source.text +
      '\n\nEnd of passage: [doc:1, chunk:11]\n\n---\n\n'
    const withFooter = hitTokenCost(source, 'en')
    expect(withFooter).toBe(estimateTokens(expectedBlock))
    expect(withFooter).toBeGreaterThan(originalCost)
    expect(packHitsToBudget([source], originalCost, 'en')).toEqual([])
    expect(packHitsToBudget([source], withFooter - 1, 'en')).toEqual([])
    expect(packHitsToBudget([source], withFooter, 'en')).toEqual([source])
  })

  for (const language of ['en', 'de'] as const) {
    for (const contextTokens of [4096, 8192]) {
      it(`budgets the actual rendered ${language} prompt with pins in ${contextTokens} tokens`, () => {
        vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
        vi.stubEnv('LOKLM_CITATION_ALIASES', undefined)
        const sources = Array.from({ length: 30 }, (_, i) =>
          hit(i + 1, `Evidence ${i + 1}: ` + 'Original complete passage. '.repeat(25)),
        )
        const question = 'Compare the supplied sources.'
        const plan = planAnswerContext({
          question,
          contextTokens,
          language,
          hits: sources.slice(1),
          pinnedGroups: [[sources[0]!]],
        })
        const prompt = buildPrompt(question, plan.hits, plan.history, language, plan.pinnedHits)
        const actualEstimate =
          estimateTokens(buildSystemPrompt(language, 'thorough')) + estimateTokens(prompt)
        expect(plan.promptTokens).toBe(actualEstimate)
        expect(plan.fits).toBe(true)
        expect(actualEstimate + plan.maxTokens + CONTEXT_PACK_MARGIN_TOKENS).toBeLessThanOrEqual(
          contextTokens,
        )
        const included = [...plan.pinnedHits, ...plan.hits]
        expect(included.length).toBeGreaterThan(1)
        expect(included.length).toBeLessThan(sources.length)
        const label = language === 'de' ? 'Ende der Passage:' : 'End of passage:'
        expect(prompt.split(label)).toHaveLength(included.length + 1)
        for (const source of included) expect(prompt).toContain(source.text + '\n\n' + label)
      })
    }
  }
})
