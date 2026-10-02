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
    expect(english).toContain('report each with its source marker')
    expect(english).toContain('If the supplied evidence does not resolve the disagreement, say so')
    expect(english).toContain(
      'explicitly establishes which source governs the requested scope and date',
    )
    expect(english).toContain(
      'A later date, higher retrieval rank, repeated passage or missing approval is not evidence of supersession',
    )
    expect(english).toContain('"Not approved" means no approval, not approval of a replacement')
    expect(english).toContain('different scopes or equivalent units need not conflict')
    expect(english).not.toContain('commit to the most likely reading')

    const german = buildSystemPrompt('de')
    expect(german).toContain('nenne jede mit ihrem Quellenmarker')
    expect(german).toContain(
      'Lösen die bereitgestellten Belege den Widerspruch nicht auf, sage das',
    )
    expect(german).toContain(
      'ausdrücklich belegt, welche Quelle für den gefragten Bereich und Zeitpunkt gilt',
    )
    expect(german).toContain(
      'Ein späteres Datum, höherer Suchrang, wiederholter Text oder eine fehlende Freigabe belegen keine Ablösung',
    )
    expect(german).toContain(
      '„Nicht freigegeben“ bedeutet fehlende Freigabe, nicht Freigabe eines Ersatzes',
    )
    expect(german).toContain(
      'verschiedene Bereiche oder gleichwertige Einheiten müssen sich nicht widersprechen',
    )
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
