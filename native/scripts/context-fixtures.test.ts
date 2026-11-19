import { afterAll, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
const { cases } = vi.hoisted(() => ({ cases: [] as unknown[] }))
vi.mock('../../src/main/services/qa/contextBudget', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/main/services/qa/contextBudget')>()
  return { ...original, planAnswerContext: (input: Parameters<typeof original.planAnswerContext>[0]) => {
    try {
      const plan = original.planAnswerContext(input)
      cases.push({ input: structuredClone(input), rejected: false, expected: {
        contextTokens: plan.contextTokens, maxTokens: plan.maxTokens, history: plan.history, pinnedHits: plan.pinnedHits, hits: plan.hits,
        contextPreamble: plan.contextPreamble ?? null, promptTokens: plan.promptTokens, fits: plan.fits, summaryOmitted: plan.summaryOmitted,
        checked: plan.prompt === undefined ? null : { prompt: plan.prompt, systemPrompt: plan.systemPrompt, admitted: !!plan.comparisonPlan, mode: plan.comparisonPlan?.comparisonMode ?? null, schema: plan.comparisonPlan ? JSON.stringify(plan.comparisonPlan.jsonSchema) : null },
      } })
      return plan
    } catch (error) { cases.push({ input: structuredClone(input), rejected: true }); throw error }
  } }
})
await import('../../tests/unit/qa-context-budget.test')
await import('../../tests/unit/checked-answer.test')
it('captures complete metadata, summaries, invalid windows and exact checked finalization', async () => {
  const { planAnswerContext } = await import('../../src/main/services/qa/contextBudget')
  const hit = (id: number, text: string, origin = '') => ({ document_id: id, chunk_id: id * 10, document_title: `Source ${id}`, text, score: 0.75, ordinal: id, origin: origin as 'primary', page_from: null, page_to: null, heading_path: ['Übersicht'], language: 'en', extra_metadata: { synthetic: true, revision: 'v1', source_uri: `synthetic://${id}` } })
  const hits = [hit(1, 'Cedar reports 8 hours. '.repeat(25)), hit(2, 'Birch reports 11 hours. '.repeat(25), 'neighbour'), hit(3, 'Priority is not established. '.repeat(25))]
  for (const contextTokens of [512, 4096, 8192]) for (const language of ['en', 'de'] as const) for (const mode of ['basic', 'full', 'summary']) {
    planAnswerContext({ contextTokens, language, question: mode === 'summary' ? 'Compare them. Answer in one sentence.' : 'Compare them.', hits, pinnedGroups: [[hits[0]!, hit(4, 'Background 90 seconds.')], [hit(5, 'Another source.')]], ...(mode === 'basic' ? { history: [{ role: 'user' as const, content: 'Earlier question.' }], summary: { title: 'Überblick', summary: 'A cached overview.' } } : { answerMode: 'checked' as const }) })
  }
  for (const contextTokens of [NaN, Infinity, -1, 0, 0.5, 4096.9]) planAnswerContext({ contextTokens, language: 'en', question: 'What is supported?', hits })
  for (const text of ['\ufeff', '\u0085', '', ' ']) planAnswerContext({ contextTokens: 8192, language: 'en', question: 'Whitespace?', hits: [hit(6, text), ...hits] })
})
afterAll(async () => {
  await writeFile('native/crates/core/tests/fixtures/original-context-budget.json', JSON.stringify({ runtime: { node: process.versions.node, icu: process.versions.icu, unicode: process.versions.unicode }, cases }, null, 2) + '\n')
})
