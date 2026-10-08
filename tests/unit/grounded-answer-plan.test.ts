import { describe, expect, it } from 'vitest'
import { planGroundedAnswer } from '../evals/native-calibration/prototypes/groundedAnswerPlan'
import { estimateTokens } from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

const hit = (text: string, id = 1): RetrievalHit => ({
  document_id: id,
  chunk_id: id * 10,
  document_title: `Source ${id}.md`,
  text,
  score: 1,
  ordinal: 0,
  page_from: null,
  page_to: null,
  heading_path: null,
  language: 'en',
})

describe('bounded source-grounded answer planning', () => {
  it('preserves every original passage alongside explicitly derived unit checks', () => {
    const hits = [
      hit('Acceptance duration: 90 seconds.'),
      hit('Commissioning duration: 1.5 minutes.', 2),
      hit('Unrelated context remains intact.', 3),
    ]
    const before = JSON.stringify(hits)
    const plan = planGroundedAnswer('Do the durations agree?', hits, 'en', 8192)!
    for (const source of hits) expect(plan.prompt).toContain(source.text)
    expect(plan.prompt).toContain('"90 seconds" = 90 s')
    expect(plan.prompt).toContain('"1.5 minutes" = 90 s')
    expect(plan.prompt).toContain('do not establish shared scope, authority, or applicability')
    expect(JSON.stringify(hits)).toBe(before)
  })

  it('includes per-source numeric function results without claiming deployment authority', () => {
    const source = hit(
      '~~~ts\nfunction clamp(n: number): number { return Math.min(10, Math.max(0, n)) }\n~~~',
    )
    const plan = planGroundedAnswer('What does clamp(9) return?', [source], 'en', 8192)!
    expect(plan.prompt).toContain('clamp(9) = 9')
    expect(plan.prompt).toContain(source.text)
    expect(plan.prompt).toContain('does not establish deployment, authority or applicability')
  })

  it('requires bounded quotations and comparison during decoding, not just post-hoc parsing', () => {
    const plan = planGroundedAnswer('What applies?', [hit('Policy text.')], 'en', 8192)!
    expect(plan.jsonSchema.properties.evidence).toMatchObject({ minItems: 1, maxItems: 4 })
    expect(plan.jsonSchema.properties.evidence.items.properties.quote).toMatchObject({
      minLength: 1,
      maxLength: 200,
    })
    expect(plan.jsonSchema.properties.comparison).toMatchObject({ minLength: 1, maxLength: 240 })
  })

  it('declines coverage instead of silently dropping oversized or duplicate evidence', () => {
    expect(planGroundedAnswer('Question', [hit('x'.repeat(30_000))], 'en', 8192)).toBeNull()
    expect(
      planGroundedAnswer('Question', [hit('First version'), hit('Second version')], 'en', 8192),
    ).toBeNull()
    expect(planGroundedAnswer('Question', [hit('Evidence', 0)], 'en', 8192)).toBeNull()
    expect(planGroundedAnswer('Question', [], 'en', 8192)).toBeNull()
  })

  it.each(['en', 'de'] as const)(
    'budgets the complete rendered %s prompt plus annotations and output',
    (language) => {
      const plan = planGroundedAnswer(
        'Do the durations agree?',
        [hit('90 seconds.'), hit('1.5 minutes.', 2)],
        language,
        4096,
      )!
      expect(plan).not.toBeNull()
      expect(
        estimateTokens(plan.prompt) + estimateTokens(plan.systemPrompt) + plan.maxTokens + 410,
      ).toBeLessThanOrEqual(4096)
      expect(plan.systemPrompt).toContain(language === 'de' ? 'auf Deutsch' : 'in English')
    },
  )
})
