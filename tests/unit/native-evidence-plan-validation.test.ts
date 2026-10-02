import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const { assertPreparedPlans } = createRequire(import.meta.url)(
  '../bench/evidence-selection.cjs',
) as { assertPreparedPlans: (prepared: unknown) => void }

function prepared(kind: string, count: number) {
  return {
    schemaVersion: 1,
    kind,
    sourceHashes: { 'out/main/modelsWorker.js': 'pinned-worker-hash' },
    cases: Array.from({ length: count }, (_, index) => ({
      expectedLiteral: `literal-${index}`,
      plan: { jsonSchema: { properties: { quote: { enum: [`literal-${index}`] } } } },
    })),
  }
}

describe('native probe plan admission', () => {
  it('keeps the evidence-order experiment restricted to exactly eight prepared plans', () => {
    expect(() => assertPreparedPlans(prepared('native-evidence-order-plans', 8))).not.toThrow()
    expect(() => assertPreparedPlans(prepared('native-evidence-order-plans', 3))).toThrow()
  })

  it('accepts three independent forced literal controls with explicit expected data', () => {
    expect(() => assertPreparedPlans(prepared('native-literal-json-plans', 3))).not.toThrow()
    expect(() => assertPreparedPlans(prepared('native-literal-json-plans', 8))).toThrow()
  })

  it('rejects a control whose grammar no longer forces its expected literal', () => {
    const changed = prepared('native-literal-json-plans', 3)
    changed.cases[0]!.plan.jsonSchema.properties.quote.enum = ['different data']
    expect(() => assertPreparedPlans(changed)).toThrow()
  })

  it('rejects unrecognized experiments and missing compiled-worker provenance', () => {
    expect(() => assertPreparedPlans(prepared('other-experiment', 3))).toThrow()
    const unpinned = prepared('native-literal-json-plans', 3)
    unpinned.sourceHashes['out/main/modelsWorker.js'] = ''
    expect(() => assertPreparedPlans(unpinned)).toThrow()
  })
})
