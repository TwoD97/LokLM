import { describe, expect, it } from 'vitest'
import {
  buildCheckedContextBundle,
  buildCheckedSystemPrompt,
} from '@main/services/qa/checkedAnswer'
import { COMPARISON_ANSWER_VERSION } from '@main/services/qa/comparisonAnswer'
import { findCitationMatches } from '@shared/citationMarkers'

describe('checked answer protocol consistency', () => {
  it.each([
    ['en', 'full'],
    ['de', 'full'],
    ['en', 'summary'],
    ['de', 'summary'],
  ] as const)(
    'keeps source identity and strict text-first admission across %s/%s',
    (language, mode) => {
      const question =
        'Compare the values.' + (mode === 'summary' ? ' Answer in one short sentence.' : '')
      const hits = [
        {
          document_id: 1,
          chunk_id: 10,
          document_title: 'A',
          text: 'The first count is 6.',
          score: 1,
        },
        {
          document_id: 2,
          chunk_id: 20,
          document_title: 'B',
          text: 'The second count is 8.',
          score: 0.9,
        },
      ].map((hit) => ({
        ...hit,
        ordinal: 0,
        language: 'en' as const,
        heading_path: null,
        page_from: null,
        page_to: null,
      }))
      const bundle = buildCheckedContextBundle(question, hits, language)
      const plan = bundle.comparisonPlan!
      expect(COMPARISON_ANSWER_VERSION).toBe('typed-comparison-v32')
      expect(plan.comparisonMode).toBe(mode)
      expect(bundle.systemPrompt).toBe(buildCheckedSystemPrompt(language, mode))
      expect(bundle.systemPrompt).not.toContain('/no_think')
      // Both instruction layers agree on generated summary versus full source
      // display; original passages receive neither unit labels nor text caps.
      if (mode === 'summary') {
        expect(bundle.systemPrompt).toContain(
          language === 'de'
            ? 'Beantworte die Question auf Deutsch'
            : 'Answer the Question in English',
        )
        expect(bundle.systemPrompt).toContain(
          language === 'de'
            ? 'Gib JSON mit check vor result'
            : 'Return JSON with check before result',
        )
        expect(bundle.systemPrompt).toContain(
          language === 'de' ? 'Diese Liste ist kein Beleg' : 'This checklist is not evidence',
        )
        expect(bundle.systemPrompt).toContain('summary:{scope:')
        expect(bundle.systemPrompt).toContain('outcome:"unresolved"')
        expect(bundle.systemPrompt).toContain('label:{kind:"heading"}')
        expect(bundle.prompt).toContain('label:{kind:"heading"}')
        for (const role of ['summary.scope', 'summary.alternatives', 'summary.grounds'])
          expect(bundle.prompt).toContain(role)
        expect(bundle.prompt).toContain(
          language === 'de' ? 'exakte Originalfragmente' : 'exact original fragment',
        )
        expect(bundle.systemPrompt).toContain(
          language === 'de'
            ? 'nicht, dass nie eine Freigabe erfolgte'
            : 'does not prove that approval never occurred',
        )
        expect(bundle.prompt).toContain('512')
        expect(bundle.systemPrompt).toContain(
          language === 'de'
            ? 'blocks:[{text:"Antworttext",sources:'
            : 'blocks:[{text:"answer text",sources:',
        )
        expect(bundle.prompt).not.toMatch(/\[U\d+\]|U-IDs|U IDs/u)
        expect(plan.conciseUnitCount).toBe(0)
      } else {
        expect(bundle.systemPrompt).toContain('blocks:[{text:"answer text",sources:')
        expect(bundle.systemPrompt).toContain('Return JSON with check followed by result.')
        expect(bundle.systemPrompt).toContain(
          'If the question asks for one governing or binding value and the supplied alternatives disagree without an established priority, explicitly state that the supplied evidence does not determine which alternative governs, while reporting the alternatives.',
        )
        expect(bundle.systemPrompt).toContain(
          'Do not replace this uncertainty with a claim that both conflicting alternatives apply.',
        )
        expect(bundle.systemPrompt).toContain(
          'Observations of different times or scopes can both be true unless the evidence requires the same state.',
        )
        expect(bundle.prompt + bundle.systemPrompt).not.toContain('summary.text')
        expect(bundle.systemPrompt).toContain('For comparison use result')
        expect(plan.summaryMaxCodePoints).toBeNull()
      }
      for (const hit of hits) expect(bundle.prompt).toContain(hit.text)
      expect(Object.keys(plan.jsonSchema.properties)).toEqual(['check', 'result'])
      expect(plan.jsonSchema.required).toEqual(['check', 'result'])
      expect(plan.jsonSchema.properties.check.maxLength).toBe(120)
      const ordinary = plan.jsonSchema.properties.result.oneOf[0]!
      expect(ordinary.properties).toHaveProperty('blocks.items.required', ['text', 'sources'])
      expect(ordinary.properties).toHaveProperty('blocks.items.properties.sources.items.enum', [
        '1:10',
        '2:20',
      ])
      for (const branch of plan.jsonSchema.properties.result.oneOf.slice(1))
        expect(Object.keys(branch.properties)).toEqual([
          'resolution',
          mode === 'summary' ? 'summary' : 'sources',
          'outcome',
        ])

      const payload = (block: unknown) =>
        JSON.stringify({
          check: 'Compare the counts.',
          result: { resolution: 'answered', blocks: [block] },
        })
      const accepted = plan.parse(
        payload({ text: 'The difference is 2.', sources: ['1:10', '2:20'] }),
        language,
        2000,
      )
      expect(accepted?.answer).toBe('The difference is 2. [doc:1, chunk:10] [doc:2, chunk:20]')
      expect(findCitationMatches(accepted!.answer).map((c) => [c.documentId, c.chunkId])).toEqual([
        [1, 10],
        [2, 20],
      ])
      expect(
        plan.parse(
          payload({ sources: ['1:10', '2:20'], text: 'The difference is 2.' }),
          language,
          2000,
        ),
      ).toBeNull()
      expect(
        plan.parse(payload({ text: 'The difference is 2.', sources: ['9:90'] }), language, 2000),
      ).toBeNull()
    },
  )
})
