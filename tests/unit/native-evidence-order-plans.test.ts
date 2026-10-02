import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import type { RetrievalHit } from '../../src/shared/documents'
import {
  evidenceOrderVariants,
  prepareEvidenceOrderPlans,
} from '../evals/native-calibration/evidenceOrderPlans'
import { describeEvidenceAssessment } from '../evals/native-calibration/report'
const { selectEvidenceCases } = createRequire(import.meta.url)(
  '../bench/evidence-selection.cjs',
) as {
  selectEvidenceCases: <T extends { caseId: string; order: string }>(
    plans: T[],
    selection?: string,
  ) => {
    cases: T[]
    selectedCases: string[]
    unrequestedCases: string[]
  }
}

describe('native evidence assessment diagnostics', () => {
  const selections = [
    { caseId: 'authority-dev-01', order: 'A-B' },
    { caseId: 'authority-dev-01', order: 'B-A' },
    { caseId: 'authority-dev-03', order: 'A-B' },
  ]
  it('defaults to every plan and preserves explicit selection order with exclusions recorded', () => {
    expect(selectEvidenceCases(selections).cases).toEqual(selections)
    expect(selectEvidenceCases(selections).unrequestedCases).toEqual([])
    expect(selectEvidenceCases(selections, 'authority-dev-03/A-B,authority-dev-01/A-B')).toEqual({
      cases: [selections[2], selections[0]],
      selectedCases: ['authority-dev-03/A-B', 'authority-dev-01/A-B'],
      unrequestedCases: ['authority-dev-01/B-A'],
    })
  })
  it.each([
    '',
    ',',
    'authority-dev-01/A-B,',
    'authority-dev-01/A-B,authority-dev-01/A-B',
    'unknown/A-B',
    'authority-dev-01/A-B-copy',
  ])('rejects invalid case/order selection %j before native launch', (selection) => {
    expect(() => selectEvidenceCases(selections, selection)).toThrow()
  })
  it('rejects duplicate prepared identities rather than silently selecting an arbitrary plan', () => {
    expect(() => selectEvidenceCases([selections[0]!, selections[0]!])).toThrow(/unique/)
  })
  it('reverses actual supplied context and gives exact duplicates distinct IDs without mutating inputs', () => {
    const a = { document_id: 1, chunk_id: 2, text: 'Original A' } as RetrievalHit
    const b = { document_id: 3, chunk_id: 4, text: 'Original B' } as RetrievalHit
    const variants = evidenceOrderVariants(a, b)
    expect(variants.map((entry) => entry.hits.map((hit) => hit.text))).toEqual([
      ['Original A', 'Original B'],
      ['Original B', 'Original A'],
      ['Original A', 'Original B', 'Original A'],
      ['Original B', 'Original A', 'Original B'],
    ])
    for (const entry of variants)
      expect(new Set(entry.hits.map((hit) => `${hit.document_id}:${hit.chunk_id}`)).size).toBe(
        entry.hits.length,
      )
    expect(a).toEqual({ document_id: 1, chunk_id: 2, text: 'Original A' })
  })

  it('prepares eight DEV-only plans using the production helper and actual source text', async () => {
    const prepared = await prepareEvidenceOrderPlans()
    expect(prepared.cases).toHaveLength(8)
    expect(new Set(prepared.cases.map((entry) => entry.caseId))).toEqual(
      new Set(['authority-dev-01', 'authority-dev-03']),
    )
    expect(prepared.cases.every((entry) => entry.plan.prompt.includes(entry.question))).toBe(true)
    expect(prepared.sourceHashes['src/main/services/qa/evidenceAssessment.ts']).toMatch(
      /^[a-f0-9]{64}$/u,
    )
  })

  it('keeps skipped, attempted-but-failed, and completed coverage distinguishable', () => {
    expect(describeEvidenceAssessment([], []).planned).toBeNull()
    expect(
      describeEvidenceAssessment(
        ['[qa] evidence coverage: { planned: false, passages: 10, documents: 10 }'],
        [],
      ),
    ).toMatchObject({ planned: false, passages: 10, stageStarted: false })
    const logs = [
      '[qa] evidence coverage: {\n planned: true,\n passages: 10, documents: 10\n}',
      "[qa] evidence assessment: { relation: 'unresolved' }",
    ]
    expect(
      describeEvidenceAssessment(logs, [{ type: 'stage', stage: 'evidence', status: 'start' }]),
    ).toMatchObject({
      planned: true,
      relation: 'unresolved',
      stageStarted: true,
      stageCompleted: false,
    })
    expect(
      describeEvidenceAssessment(logs, [
        { type: 'stage', stage: 'evidence', status: 'done', durationMs: 44000 },
      ]),
    ).toMatchObject({ stageCompleted: true, durationMs: 44000 })
  })
})
