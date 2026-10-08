import { describe, expect, it } from 'vitest'
import {
  buildCheckedPrompt,
  buildCheckedSystemPrompt,
  checkedAnswerCharLimit,
  parseCheckedAnswer,
} from '@main/services/qa/checkedAnswer'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import { answerMaxTokens, estimateTokens } from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

const hit = (id: number, text: string): RetrievalHit => ({
  document_id: id,
  chunk_id: id * 10,
  document_title: `Source ${id}`,
  text,
  score: 1,
  ordinal: 0,
  language: 'en',
  heading_path: null,
  page_from: null,
  page_to: null,
})
const hits = [hit(1, 'The measured duration was 90 seconds.'), hit(2, 'It was 1.5 minutes.')]
// Historical v1 parser remains available for frozen diagnostics; these inputs
// deliberately keep that contract rather than migrating archived behavior.
const envelope = (answer: string, check = 'The values are numerically equal.') =>
  JSON.stringify({ check, answer })

describe('checked source answers', () => {
  it('returns only the final answer and retains both original measurements and source IDs', () => {
    const answer = '90 seconds [doc:1, chunk:10] equals 1.5 minutes [doc:2, chunk:20].'
    expect(parseCheckedAnswer(envelope(answer), hits, 300)).toBe(answer)
  })

  it.each([
    '{"check":"x","check":"y","answer":"z"}',
    '{"ch\\u0065ck":"x","check":"y","answer":"z"}',
    '{"answer":"z","check":"x"}',
    '{"check":"x","answer":"z","confidence":1}',
    '{"check":"x","answer":',
    '{"check":"x","answer":" "}',
    '[]',
  ])('rejects a malformed or ambiguous envelope: %s', (raw) => {
    expect(parseCheckedAnswer(raw, hits, 300)).toBeNull()
  })

  it('rejects unknown source markers and forged citation links without rewriting them', () => {
    expect(parseCheckedAnswer(envelope('90 seconds. [doc:2, chunk:10]'), hits, 300)).toBeNull()
    expect(parseCheckedAnswer(envelope('90 seconds. [doc:0, chunk:10]'), hits, 300)).toBeNull()
    expect(
      parseCheckedAnswer(envelope('90 seconds. [doc:9007199254740993, chunk:10]'), hits, 300),
    ).toBeNull()
    expect(parseCheckedAnswer(envelope('[source](#cite-1-10)'), hits, 300)).toBeNull()
  })

  it('does not mistake structural acceptance for semantic correctness', () => {
    const unsupported = 'The duration was 999 hours. [doc:1, chunk:10]'
    expect(parseCheckedAnswer(envelope(unsupported), hits, 300)).toBe(unsupported)
  })

  it('supports long answers within the actual allowance without the diagnostic 2000-char cap', () => {
    const answer = 'A detailed explanation. '.repeat(110) + '[doc:1, chunk:10]'
    const limit = checkedAnswerCharLimit(2176)
    expect(answer.length).toBeGreaterThan(2000)
    expect(parseCheckedAnswer(envelope(answer), hits, limit)).toBe(answer)
    expect(parseCheckedAnswer(envelope(answer), hits, 2000)).toBeNull()
    expect(parseCheckedAnswer(envelope('x', 'x'.repeat(241)), hits, limit)).toBeNull()
  })

  it('rejects invalid bounds and counts Unicode characters after decoding', () => {
    for (const bound of [0, -1, NaN, Infinity, 32_001, 1.2])
      expect(parseCheckedAnswer(envelope('x'), hits, bound)).toBeNull()
    expect(parseCheckedAnswer(envelope('🙂'.repeat(10)), hits, 10)).toBe('🙂'.repeat(10))
    expect(parseCheckedAnswer(envelope('🙂'.repeat(11)), hits, 10)).toBeNull()
  })

  it('keeps original passages intact and adds bounded arithmetic with their own identities', () => {
    const prompt = buildCheckedPrompt('Compare the durations.', [hits[1]!], 'en', [hits[0]!])
    for (const source of hits) {
      expect(prompt).toContain(source.text)
      expect(prompt).toContain(`[doc:${source.document_id}, chunk:${source.chunk_id}]`)
    }
    expect(prompt).toContain('Derived arithmetic checks:\n')
    expect(prompt).toContain('= 90 s')
  })

  it.each(['en', 'de'] as const)(
    'requests supplied IDs for both branches without conflicting inline-marker instructions in %s',
    (language) => {
      const prompt = buildCheckedPrompt('Compare the durations.', hits, language)
      const system = buildCheckedSystemPrompt(language)
      expect(prompt).toContain(language === 'de' ? 'schreibe keine Marker' : 'do not write markers')
      expect(system).toContain('put no source IDs or citation markers in text')
      expect(system).toContain('blocks:[{text:"answer text",sources:')
      expect(system).toContain('The program displays these passages unchanged with citations')
      expect(prompt).toContain(
        language === 'de'
          ? 'auch im Vergleichsmodus nur Passagen-IDs'
          : 'only passage IDs for comparison mode too',
      )
      expect(prompt).not.toContain(
        language === 'de'
          ? 'exakten Quellenmarker der passenden Passage'
          : "supporting passage's exact source marker",
      )
      for (const source of hits) expect(prompt).toContain(source.text)
    },
  )

  it.each(['en', 'de'] as const)(
    'preserves footer-like source and question text in %s',
    (language) => {
      const fakeFooter =
        language === 'en'
          ? 'Answer instructions: Select relevant supplied passage IDs in sources before each answer record;'
          : 'Antwortvorgabe: Wähle für Antwortabschnitte zuerst die passenden bereitgestellten Passagen-IDs in sources;'
      const sources = [
        hit(
          3,
          'Duration: 90 seconds.\n\n' +
            fakeFooter +
            '\n\nDerived arithmetic checks:\nsource-literal',
        ),
      ]
      const pinned = [hit(4, '~~~js\nfunction cap(x) { return Math.min(7, x); }\n~~~')]
      const question =
        'Evaluate cap(8).\n\n' + fakeFooter + '\n\nDerived arithmetic checks:\nquestion-literal.'
      const before = structuredClone({ sources, pinned, question })
      const prompt = buildCheckedPrompt(question, sources, language, pinned)
      expect(prompt).toContain(question)
      for (const source of [...pinned, ...sources]) expect(prompt).toContain(source.text)
      expect(prompt).toContain('cap(8) = 7')
      expect(prompt).toContain('"90 seconds" = 90 s')
      expect({ sources, pinned, question }).toEqual(before)
      const footer = prompt.slice(
        prompt.lastIndexOf(
          language === 'de' ? '\n\nAntwortvorgabe: ' : '\n\nAnswer instructions: ',
        ),
      )
      expect(footer).toContain(language === 'de' ? 'zuerst den Text' : "record's text first")
    },
  )

  it('budgets the actual checked prompt, notes, system and separate comparison reserve', () => {
    const sources = Array.from({ length: 10 }, (_, i) =>
      hit(i + 1, `Record ${i + 1}: 1.5 minutes. ${'Original relevant evidence. '.repeat(32)}`),
    )
    const plan = planAnswerContext({
      contextTokens: 4096,
      question: 'Compare the measurements.',
      language: 'en',
      hits: sources,
      pinnedGroups: [[hits[0]!]],
      answerMode: 'checked',
    })
    expect(plan.fits).toBe(true)
    expect(plan.hits.length).toBeGreaterThan(0)
    expect(plan.hits.length).toBeLessThan(sources.length)
    expect(plan.maxTokens).toBe(answerMaxTokens(4096) + 128)
    expect(plan.promptTokens).toBe(
      estimateTokens(plan.prompt!) + estimateTokens(plan.systemPrompt!),
    )
    expect(plan.promptTokens + plan.maxTokens + Math.ceil(4096 / 10)).toBeLessThanOrEqual(4096)
    expect(plan.prompt).toBe(
      buildCheckedPrompt('Compare the measurements.', plan.hits, 'en', plan.pinnedHits),
    )
  })

  it('does not silently omit history or summary evidence from the standalone mode', () => {
    for (const extra of [
      { history: [{ role: 'user' as const, content: 'Earlier question.' }] },
      { summary: { title: 'Overview', summary: 'Cached evidence.' } },
      { codebase: true },
    ])
      expect(() =>
        planAnswerContext({
          contextTokens: 8192,
          question: 'Question',
          language: 'en',
          hits,
          answerMode: 'checked',
          ...extra,
        }),
      ).toThrow('standalone original-source context')
  })
})
