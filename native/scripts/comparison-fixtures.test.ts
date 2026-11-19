import { afterAll, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
const { cases, plans, wellFormed } = vi.hoisted(() => {
  const wellFormed = (value: unknown): boolean => typeof value === 'string' ? !/[\ud800-\udfff]/u.test(value) : value !== null && typeof value === 'object' ? Object.values(value).every(wellFormed) : true
  return { cases: [] as unknown[], plans: [] as unknown[], wellFormed }
})
vi.mock('../../src/main/services/qa/comparisonAnswer', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/main/services/qa/comparisonAnswer')>()
  const markers = await import('../../src/shared/citationMarkers')
  return { ...original, createComparisonAnswerPlan: (...args: Parameters<typeof original.createComparisonAnswerPlan>) => {
    const plan = original.createComparisonAnswerPlan(...args)
    const id = plans.length
    plans.push({ question: args[0], input: structuredClone(args[1]), unicodeTransport: wellFormed(args), admitted: plan !== null, expected: plan ? { version: plan.version, comparisonMode: plan.comparisonMode, conciseUnitCount: plan.conciseUnitCount, summaryMaxCodePoints: plan.summaryMaxCodePoints, schema: JSON.stringify(plan.jsonSchema) } : null })
    if (!plan) return null
    return { ...plan, parse: (...args: Parameters<typeof plan.parse>) => {
      let reason: string | null = null, ordinary: string | null = null, comparison: string | null = null
      const expected = plan.parse(args[0], args[1], args[2], value => { reason = value; args[3]?.(value) }, value => { ordinary = value; args[4]?.(value) }, value => { comparison = value; args[5]?.(value) })
      let unicodeTransport = true
      try { unicodeTransport = wellFormed(JSON.parse(args[0])) } catch { /* Invalid JSON is an ordinary rejection fixture. */ }
      cases.push({ plan: id, raw: args[0] ?? null, language: args[1], max: args[2], unicodeTransport, faultInjected: vi.isMockFunction(markers.findCitationMatches), expected, reason, ordinary, comparison })
      return expected
    } }
  } }
})
await import('../../tests/unit/comparison-answer.test')
await import('../../tests/unit/answer-format.test')
await import('../../tests/unit/conflict-summary.test')
await import('../../tests/unit/comparison-summary.test')
afterAll(async () => {
  await writeFile('native/crates/core/tests/fixtures/original-comparison-answer.json', JSON.stringify({ runtime: { node: process.versions.node, icu: process.versions.icu, unicode: process.versions.unicode }, plans, cases }, null, 2) + '\n')
})
