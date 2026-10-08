import { describe, expect, it } from 'vitest'
import {
  buildCheckedContextBundle,
  buildCheckedPrompt,
  buildCheckedSystemPrompt,
} from '@main/services/qa/checkedAnswer'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import { estimateTokens } from '@main/services/llm/prompt'
import { findCitationMatches } from '@shared/citationMarkers'
import type { RetrievalHit } from '@shared/documents'
import { conflictSummarySchema } from '@main/services/qa/conflictSummary'

const hit = (id: number, text: string): RetrievalHit => ({
  document_id: id,
  chunk_id: id * 10,
  document_title: `Record ${id}`,
  text,
  score: 1,
  ordinal: 0,
  language: 'en',
  heading_path: null,
  page_from: null,
  page_to: null,
})

function summaryContract(schema: unknown) {
  const typed = schema as {
    properties: {
      result: {
        oneOf: Array<{
          properties: {
            blocks?: {
              items: { properties: { sources: { items: { enum: string[] } } } }
            }
            summary?: ReturnType<typeof conflictSummarySchema>
          }
        }>
      }
    }
  }
  return {
    ...typed.properties.result.oneOf.find((branch) => branch.properties.summary)!.properties
      .summary!.properties,
    ordinarySourceIds:
      typed.properties.result.oneOf[0]!.properties.blocks!.items.properties.sources.items.enum,
  }
}

describe('one checked source catalog across prompt, budget and parser', () => {
  it.each([
    ['en', 'Which recorded value governs? Answer in one short sentence.'],
    ['de', 'Welcher erfasste Wert gilt? Antworte in einem kurzen Satz.'],
  ] as const)(
    'keeps original passages and one consistent bounded summary contract in %s',
    (language, question) => {
      const original = [
        hit(1, 'For the recorded count, First entry records 31 units without documented priority.'),
        hit(
          2,
          'For the recorded count, Second entry records 34 units without documented priority.',
        ),
      ]
      const before = structuredClone(original)
      const bundle = buildCheckedContextBundle(question, [original[1]!], language, [original[0]!])
      const plan = bundle.comparisonPlan!
      expect(plan.comparisonMode).toBe('summary')
      expect(plan.conciseUnitCount).toBe(0)
      expect(plan.jsonSchema.properties.result.oneOf).toHaveLength(2)
      const contract = summaryContract(plan.jsonSchema)
      const catalog = ['1:10', '2:20']
      expect(contract.scope.items.properties.source.enum).toEqual(catalog)
      expect(contract.alternatives.items.properties.source.enum).toEqual(catalog)
      expect(contract.grounds.items.properties.evidence.items.properties.source.enum).toEqual(
        catalog,
      )
      expect(contract.ordinarySourceIds).toEqual(catalog)
      expect(contract.scope.items.properties.text.maxLength).toBe(160)
      expect(contract.alternatives.items.properties.label.oneOf[0]!.maxLength).toBe(80)
      expect(plan.summaryMaxCodePoints).toBe(512)
      for (const source of original) {
        expect(plan.promptSourceText(source.document_id, source.chunk_id)).toBe(source.text)
        expect(bundle.prompt).toContain(plan.promptSourceText(source.document_id, source.chunk_id))
        expect(bundle.prompt.split(source.text)).toHaveLength(2)
      }
      expect(bundle.prompt).not.toMatch(/\[U\d+\]|U-IDs|U IDs|\bin units\b/u)
      expect(bundle.prompt).not.toContain('displays comparison passages in full')
      expect(bundle.prompt).not.toContain('zeigt Vergleichspassagen vollständig')
      expect(bundle.systemPrompt).toContain('summary:{scope:')
      expect(bundle.systemPrompt).toContain('outcome:"unresolved"')
      const limit =
        language === 'de'
          ? `Grenze für die vollständige Anzeige von summary: ${plan.summaryMaxCodePoints} Zeichen`
          : `Limit for the complete rendered summary: ${plan.summaryMaxCodePoints} characters`
      expect(bundle.prompt.split(limit)).toHaveLength(2)
      expect(bundle.prompt.split('\n\n').at(-1)).toContain(limit)
      expect(bundle.prompt + bundle.systemPrompt).not.toMatch(
        /recordCount|fragmentCount|Excerpt budgets|Ausschnittbudgets/u,
      )
      expect(plan).not.toHaveProperty('excerptBudgetRows')
      expect(original).toEqual(before)

      // Every selected role is tied to the immutable source catalog captured
      // with the prompt, including grounds that the renderer does not quote.
      const schemaBefore = structuredClone(plan.jsonSchema)
      const limitBefore = plan.summaryMaxCodePoints
      original[0]!.text = 'A later, unrelated replacement.'
      original[0]!.document_title = '&'.repeat(64)
      original[0]!.document_id = 99
      original[0]!.chunk_id = 990
      expect(plan.jsonSchema).toEqual(schemaBefore)
      expect(plan.summaryMaxCodePoints).toBe(limitBefore)
      const response = (references: string[]) =>
        JSON.stringify({
          check: 'Both counts, attribution and documentary priority.',
          result: {
            resolution: 'comparison',
            summary: {
              scope: [{ text: 'recorded count', source: references[0] }],
              alternatives: [
                { label: 'First entry', value: '31 units', source: references[0] },
                { label: 'Second entry', value: '34 units', source: references[1] },
              ],
              grounds: [
                {
                  kind: 'priority',
                  evidence: before.map((source, index) => ({
                    text: source.text,
                    source: references[index],
                  })),
                },
              ],
            },
            outcome: 'unresolved',
          },
        })
      const parsed = plan.parse(response(['1:10', '2:20']), language, 16_000)
      expect(parsed).not.toBeNull()
      expect(plan.promptSourceText(1, 10)).toBe(before[0]!.text)
      expect(() => plan.promptSourceText(99, 990)).toThrow()
      expect(plan.parse(response(['99:990', '2:20']), language, 16_000)).toBeNull()
      expect(parsed?.spans).toHaveLength(7)
      expect(parsed?.displaySpans).toHaveLength(5)
      for (const span of parsed!.spans) {
        const source = before.find(
          (entry) => `${entry.document_id}:${entry.chunk_id}` === span.source,
        )!
        expect(source.text.slice(span.start, span.end)).toBe(span.text)
      }
      expect(parsed?.derivations).toEqual([])
      expect(parsed?.answer).toContain('31')
      expect(parsed?.answer).toContain('34')
      expect(parsed?.answer).not.toContain('unrelated replacement')
      expect(Array.from(parsed!.answer).length).toBeLessThanOrEqual(512)
      expect(findCitationMatches(parsed!.answer).map((c) => [c.documentId, c.chunkId])).toEqual([
        [1, 10],
        [1, 10],
        [2, 20],
        [1, 10],
        [2, 20],
      ])
    },
  )

  it('keeps the full contract for normal questions and original long summary-mode sources', () => {
    const question = 'Explain the recorded result.'
    const sources = [hit(1, 'The recorded count is 31.')]
    const normal = buildCheckedContextBundle(question, sources, 'en')
    expect(normal.comparisonPlan?.comparisonMode).toBe('full')
    expect(normal.comparisonPlan?.summaryMaxCodePoints).toBeNull()
    expect(normal.comparisonPlan?.jsonSchema.properties.result.oneOf).toHaveLength(3)
    expect(normal.prompt).toBe(buildCheckedPrompt(question, sources, 'en'))
    expect(normal.systemPrompt).toBe(buildCheckedSystemPrompt('en'))

    const shortQuestion = 'Explain the recorded result. Answer in one sentence.'
    const longSource = [hit(2, 'One complete source statement. '.repeat(257))]
    const fallback = buildCheckedContextBundle(shortQuestion, longSource, 'en')
    expect(fallback.comparisonPlan?.comparisonMode).toBe('summary')
    expect(fallback.comparisonPlan?.conciseFallbackReason).toBeUndefined()
    expect(fallback.comparisonPlan?.conciseUnitCount).toBe(0)
    expect(fallback.comparisonPlan?.jsonSchema.properties.result.oneOf).toHaveLength(2)
    expect(fallback.prompt).toContain(longSource[0]!.text)
    expect(fallback.systemPrompt).toBe(buildCheckedSystemPrompt('en', 'summary'))
  })

  it('budgets the final summary contract and retains exactly the packed source IDs after dropping evidence', () => {
    const question = 'Compare the recorded facts. Answer in one short sentence.'
    const pinned = hit(1, `Pinned fact: ${'pinned evidence '.repeat(20)}.`)
    const sources = Array.from({ length: 18 }, (_, i) =>
      hit(i + 2, `Record ${i + 2}: ${'original evidence '.repeat(25)}.`),
    )
    const before = structuredClone([pinned, ...sources])
    const plan = planAnswerContext({
      contextTokens: 4096,
      question,
      language: 'en',
      pinnedGroups: [[pinned]],
      hits: sources,
      answerMode: 'checked',
    })
    expect(plan.fits).toBe(true)
    expect(plan.pinnedHits).toEqual([pinned])
    expect(plan.hits.length).toBeGreaterThan(0)
    expect(plan.hits.length).toBeLessThan(sources.length)
    expect(plan.comparisonPlan?.comparisonMode).toBe('summary')
    const supplied = [...plan.pinnedHits, ...plan.hits]
    const contract = summaryContract(plan.comparisonPlan!.jsonSchema)
    const catalog = supplied.map((source) => `${source.document_id}:${source.chunk_id}`)
    expect(contract.scope.items.properties.source.enum).toEqual(catalog)
    expect(contract.alternatives.items.properties.source.enum).toEqual(catalog)
    expect(contract.grounds.items.properties.evidence.items.properties.source.enum).toEqual(catalog)
    expect(contract.ordinarySourceIds).toEqual(catalog)
    expect(plan.comparisonPlan!.summaryMaxCodePoints).toBe(512)
    expect(plan.prompt).toContain('Limit for the complete rendered summary: 512 characters')
    for (const source of supplied)
      expect(plan.prompt).toContain(
        plan.comparisonPlan!.promptSourceText(source.document_id, source.chunk_id),
      )
    for (const removed of sources.filter((source) => !plan.hits.includes(source))) {
      expect(plan.prompt).not.toContain(`[doc:${removed.document_id}, chunk:${removed.chunk_id}]`)
      expect(() =>
        plan.comparisonPlan!.promptSourceText(removed.document_id, removed.chunk_id),
      ).toThrow()
    }
    expect(plan.promptTokens).toBe(
      estimateTokens(plan.prompt!) + estimateTokens(plan.systemPrompt!),
    )
    expect(plan.promptTokens + plan.maxTokens + Math.ceil(4096 / 10)).toBeLessThanOrEqual(4096)
    expect(plan.prompt).toBe(
      buildCheckedPrompt(question, plan.hits, 'en', plan.pinnedHits, plan.comparisonPlan),
    )
    expect([pinned, ...sources]).toEqual(before)
  })
})
