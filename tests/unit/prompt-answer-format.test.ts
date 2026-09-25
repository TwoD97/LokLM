import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPrompt, buildSystemPrompt, estimateTokens } from '@main/services/llm/prompt'
import { createCitationAliases } from '@main/services/llm/citationAliases'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import type { RetrievalHit } from '@shared/documents'

afterEach(() => vi.unstubAllEnvs())

const source: RetrievalHit = {
  document_id: 5,
  chunk_id: 8,
  document_title: 'Results',
  ordinal: 0,
  page_from: null,
  page_to: null,
  heading_path: null,
  language: null,
  text: 'The measured result is 42 units.',
  score: 1,
}

describe('answer format and citation reminders', () => {
  it('distinguishes source conflicts from unclear questions and requires explicit resolution', () => {
    const english = buildSystemPrompt('en')
    expect(english).toContain('report both values with their source markers')
    expect(english).toContain('the conflict is unresolved')
    expect(english).toContain('approval or supersession')
    expect(english).toContain('a later date alone is insufficient')
    expect(english).not.toContain('commit to the most likely reading')

    const german = buildSystemPrompt('de')
    expect(german).toContain('nenne beide Werte mit ihren Quellenmarkern')
    expect(german).toContain('den Widerspruch als ungeklärt')
    expect(german).toContain('ausdrückliche Freigabe oder Ablösung')
    expect(german).toContain('ein späteres Datum allein reicht nicht')
    expect(german).not.toContain('wahrscheinlichste Lesart')
  })
  it.each(['en', 'de'] as const)(
    'keeps requested brevity compatible with careful %s calculations',
    (language) => {
      const prompt = buildSystemPrompt(language)
      expect(prompt).toContain(
        language === 'en' ? 'without a separate derivation' : 'ohne gesonderten Rechenweg',
      )
      expect(prompt).toContain(language === 'en' ? 'Calculate carefully' : 'Rechne sorgfältig')
    },
  )

  it.each(['en', 'de'] as const)(
    'adds the %s reminder after the unchanged question for excerpts or pins',
    (language) => {
      const question = 'Return one sentence with the exact result.'
      const label = language === 'en' ? 'Answer instructions:' : 'Antwortvorgabe:'
      for (const pinned of [false, true]) {
        const prompt = buildPrompt(
          question,
          pinned ? [] : [source],
          [],
          language,
          pinned ? [source] : [],
        )
        expect(prompt).toContain(`Question: ${question}\n\n${label}`)
        expect(prompt).toContain(
          language === 'en' ? 'If the requested fact is missing' : 'Fehlt die gesuchte Information',
        )
        expect(prompt).toContain(source.text)
      }
    },
  )

  it('does not require citations for no evidence, blank passages, or an overview alone', () => {
    for (const language of ['en', 'de'] as const) {
      for (const prompt of [
        buildPrompt('Question?', [], [], language),
        buildPrompt('Question?', [{ ...source, text: '  ' }], [], language),
        buildPrompt('Question?', [], [], language, [], 'Overview with no source marker.'),
      ]) {
        expect(prompt.endsWith('Question: Question?')).toBe(true)
      }
    }
  })

  it.each(['en', 'de'] as const)(
    'accounts for the same %s reminder in canonical budget estimates and aliased prompts',
    (language) => {
      vi.stubEnv('LOKLM_CITATION_ALIASES', '1')
      const question = 'Give the result in one sentence.'
      const plan = planAnswerContext({ contextTokens: 4096, question, language, hits: [source] })
      expect(plan.fits).toBe(true)
      expect(plan.hits).toHaveLength(1)
      const canonical = buildPrompt(
        question,
        plan.hits,
        plan.history,
        language,
        plan.pinnedHits,
        plan.contextPreamble,
      )
      const aliased = buildPrompt(
        question,
        plan.hits,
        plan.history,
        language,
        plan.pinnedHits,
        plan.contextPreamble,
        createCitationAliases(plan.hits, plan.pinnedHits),
      )
      expect(canonical.slice(canonical.indexOf('Question:'))).toBe(
        aliased.slice(aliased.indexOf('Question:')),
      )
      expect(plan.promptTokens).toBe(
        estimateTokens(buildSystemPrompt(language, 'thorough')) + estimateTokens(canonical),
      )
      expect(estimateTokens(aliased)).toBeLessThanOrEqual(estimateTokens(canonical))
    },
  )
})
