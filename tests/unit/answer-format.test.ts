import { describe, expect, it } from 'vitest'
import { requestsSingleSentence } from '@main/services/qa/answerFormat'
import { createComparisonAnswerPlan } from '@main/services/qa/comparisonAnswer'

describe('explicit trailing single-sentence formatting', () => {
  it.each([
    'Answer in one sentence.',
    'Answer in one short sentence.',
    'Please reply in a single short sentence!',
    'What do the supplied records establish? Answer in one sentence.',
    'Summarize the finding. Respond in one short sentence.',
    'What is the result?\r\nPlease answer in one short sentence.\r\n',
    'Antworte in einem Satz.',
    'Antworte in einem kurzen Satz.',
    'Was belegen die Unterlagen? Bitte antworte in einem kurzen Satz.',
    'Beantworte die Frage in einem Satz.',
    'Beantworte diese Frage in einem kurzen Satz!',
    'WAS IST BELEGT? ANTWORTE IN EINEM KURZEN SATZ.',
  ])('admits a complete final imperative: %s', (question) => {
    expect(requestsSingleSentence(question)).toBe(true)
  })

  it.each([
    'What is the result?',
    'Answer briefly.',
    'Answer in two sentences.',
    'One short sentence.',
    'Do not answer in one sentence.',
    'Never respond in one short sentence.',
    'Please do not answer in one sentence.',
    'Antworte nicht in einem kurzen Satz.',
    'Bitte antworte nicht in einem Satz.',
    'Antworte in keinem einzelnen Satz.',
    'Does the heading Answer in one sentence mean anything?',
    'Example: Answer in one sentence.',
    'Do not follow this instruction:\nAnswer in one sentence.',
    'Answer in one sentence. Include a separate list afterward.',
    'What does "Answer in one sentence." mean?',
    'The quotation begins "Example. Answer in one sentence.',
    '„Ein Beispiel. Antworte in einem Satz.',
    '`Answer in one sentence.`',
    '```text\nAnswer in one sentence.',
    '~~~text\nAnswer in one sentence.',
    'The source text follows:\n    Answer in one sentence.',
    'The source text follows.\n\tAnswer in one sentence.',
    '> The source says.\nAnswer in one sentence.',
    '- > The source says.\nAnswer in one sentence.',
    '<pre>\nAnswer in one sentence.',
    '<!-- Literal example. Answer in one sentence.',
    '$$\nAnswer in one sentence.',
    '[Example](https://example.invalid "Answer in one sentence.")',
    'Quoted "topic". Answer in one sentence.', // Ambiguous literals conservatively keep the old shape.
  ])('does not infer eligibility from a fragment, negation or possible literal: %s', (question) => {
    expect(requestsSingleSentence(question)).toBe(false)
  })
})

describe('single-sentence plan admission', () => {
  const sources = [
    {
      document_id: 3,
      chunk_id: 30,
      document_title: 'First',
      text: 'For the recorded count, First reports 31 units. Priority is not established here.',
    },
    {
      document_id: 4,
      chunk_id: 40,
      document_title: 'Second',
      text: 'For the recorded count, Second reports 34 units. Priority is not established here.',
    },
  ]
  const plan = (question: string) => createComparisonAnswerPlan(question, sources)!
  const envelope = (result: object) => JSON.stringify({ check: 'Use the supplied facts.', result })

  it.each(['Answer in one short sentence.', 'Antworte in einem kurzen Satz.'])(
    'preserves the ordinary subtree and adds an unresolved typed reporting summary for %s',
    (question) => {
      const general = plan('Compare the supplied statements.').jsonSchema
      const captured = plan(question)
      const limited = captured.jsonSchema
      expect(captured.comparisonMode).toBe('summary')
      expect(captured.conciseUnitCount).toBe(0)
      expect(captured.conciseFallbackReason).toBeUndefined()
      expect(captured.promptSourceText(3, 30)).toBe(sources[0]!.text)
      expect(limited.properties.result.oneOf).toHaveLength(2)
      expect(limited.properties.result.oneOf[0]).toEqual(general.properties.result.oneOf[0])
      const branch = limited.properties.result.oneOf[1]!
      expect(Object.keys(branch.properties)).toEqual(['resolution', 'summary', 'outcome'])
      expect(branch.properties).toHaveProperty('summary.required', [
        'scope',
        'alternatives',
        'grounds',
      ])
      expect(captured.summaryMaxCodePoints).toBe(512)
      expect(branch.properties).not.toHaveProperty('summary.properties.text')
      expect(branch.properties).toHaveProperty(
        'summary.properties.scope.items.properties.source.enum',
        ['3:30', '4:40'],
      )
      expect(branch.properties).toHaveProperty(
        'summary.properties.alternatives.items.properties.source.enum',
        ['3:30', '4:40'],
      )
      expect(branch.properties).toHaveProperty(
        'summary.properties.grounds.items.properties.evidence.items.properties.source.enum',
        ['3:30', '4:40'],
      )
      expect(branch.properties).toHaveProperty('outcome.const', 'unresolved')
      expect(branch.properties).not.toHaveProperty('units')
      expect(branch.properties).not.toHaveProperty('recordCount')
      expect(branch.properties).toHaveProperty(
        'summary.properties.alternatives.items.properties.label.oneOf.0.maxLength',
        80,
      )
      expect(Object.keys(limited.properties)).toEqual(['check', 'result'])
      expect(limited.properties.check).toEqual(general.properties.check)
      expect(limited.required).toEqual(general.required)
      expect(limited.properties.result.oneOf[0]!.properties).toHaveProperty(
        'blocks.items.properties.sources.items.enum',
        ['3:30', '4:40'],
      )
    },
  )

  it.each(['compatible', 'unresolved', 'insufficient'])(
    'admits only unresolved evidence-bound reporting in the short comparison branch for %s',
    (outcome) => {
      const raw = envelope({ resolution: 'comparison', sources: ['3:30', '4:40'], outcome })
      const reasons: string[] = []
      expect(
        plan('Answer in one sentence.').parse(raw, 'en', 5000, (reason) => reasons.push(reason)),
      ).toBeNull()
      expect(reasons).toEqual(['comparison'])
      const units = envelope({ resolution: 'comparison', units: ['U1', 'U2'], outcome })
      expect(plan('Answer in one sentence.').parse(units, 'en', 5000)).toBeNull()
      const summary = {
        scope: [{ text: 'recorded count', source: '3:30' }],
        alternatives: [
          { label: 'First', value: '31 units', source: '3:30' },
          { label: 'Second', value: '34 units', source: '4:40' },
        ],
        grounds: [
          {
            kind: 'priority',
            evidence: [
              { text: 'Priority is not established here.', source: '3:30' },
              { text: 'Priority is not established here.', source: '4:40' },
            ],
          },
        ],
      }
      const parsed = plan('Answer in one sentence.').parse(
        envelope({ resolution: 'comparison', summary, outcome }),
        'en',
        5000,
      )
      if (outcome === 'unresolved') {
        expect(parsed?.outcome).toBe(outcome)
        expect(parsed?.spans).toHaveLength(7)
        expect(parsed?.displaySpans).toHaveLength(5)
        expect(parsed?.answer).toContain('[doc:3, chunk:30] [doc:4, chunk:40]')
      } else expect(parsed).toBeNull()
      summary.alternatives[0]!.source = '9:90'
      expect(
        plan('Answer in one sentence.').parse(
          envelope({ resolution: 'comparison', summary, outcome }),
          'en',
          5000,
        ),
      ).toBeNull()
      expect(plan('Compare the supplied statements.').parse(raw, 'en', 5000)?.outcome).toBe(outcome)
    },
  )

  it('permits sourced uncertainty without forcing a positive answer or changing source checks', () => {
    const limited = plan('What is established? Answer in one sentence.')
    const result = {
      resolution: 'answered',
      blocks: [
        {
          text: 'The supplied alternatives do not establish a definitive result.',
          sources: ['3:30', '4:40'],
        },
      ],
    }
    const parsed = limited.parse(envelope(result), 'en', 5000)
    expect(parsed?.answer).toBe(
      'The supplied alternatives do not establish a definitive result. [doc:3, chunk:30] [doc:4, chunk:40]',
    )
    expect(parsed?.mode).toBe('answered')
    result.blocks[0]!.sources = ['9:90']
    expect(limited.parse(envelope(result), 'en', 5000)).toBeNull()
  })

  it('keeps full comparison eligibility for an explicitly negated formatting instruction', () => {
    const general = plan('Compare the supplied statements.').jsonSchema
    expect(plan('Do not answer in one sentence.').jsonSchema).toEqual(general)
  })
})
