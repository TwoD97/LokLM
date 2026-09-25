import { describe, expect, it } from 'vitest'
import { CASES } from '../evals/production/fixtures'
import { runProductionCase } from '../evals/production/harness'

// Synthetic scores + inference isolate control flow; REAL production services do retrieval and packing.
describe.each([4096, 8192])('production RetrievalService → QAService at %i tokens', (context) => {
  it.each(CASES.filter((testCase) => !testCase.knownLimitation))(
    '$id retains required post-packing evidence or refuses without generation',
    async (testCase) => {
      const result = await runProductionCase(testCase, context)
      expect(result.errors).toEqual([])
      expect(result.refused).toBe(testCase.shouldRefuse)
      expect(result.sourceTextUnchanged).toBe(true)
      expect(result.citationEvidenceMatches).toBe(true)
      expect(result.estimatedTotalTokens).toBeLessThanOrEqual(context)
      if (testCase.required.length) expect(result.requiredEvidenceCoverage).toBe(1)
      if (testCase.shouldRefuse) {
        expect(result.generationCalls).toBe(0)
        expect(result.citationIds).toEqual([])
      } else {
        expect(result.generationCalls).toBe(1)
        expect(result.outputLimitProvided).toBe(true)
        expect(result.generationTokens).toBeLessThanOrEqual(context / 4)
      }
      if (testCase.history?.length) {
        expect(result.historyCharsAfter).toBeGreaterThan(0)
        expect(result.historyCharsAfter).toBeLessThan(result.historyCharsBefore)
      }
      if (testCase.pinnedDocumentIds?.length) {
        expect(result.citationIds).toEqual([11, 51, 61])
        expect(new Set(result.citationIds).size).toBe(result.citationIds.length)
      }
      if (testCase.id === 'oversize-neighbour') {
        expect(result.retrieved.map((hit) => hit.id)).toContain(52)
        expect(result.fed.map((hit) => hit.id)).toEqual([51, 61])
      }
      if (testCase.id === 'single-oversize') {
        expect(result.refusalReason).toBe('context_limit')
        expect(result.refusalMessage).toContain('Kontextfenster')
      }
      if (testCase.id.startsWith('empty-')) expect(result.refusalReason).toBe('no_hits')
      expect(result.checksPassed).toBe(true)
    },
  )

  it('reports weak-only evidence as an unresolved answerability limitation, not success', async () => {
    const testCase = CASES.find((entry) => entry.id === 'weak-only')!
    const result = await runProductionCase(testCase, context)
    expect(result.knownLimitation).toMatch(/answerability/)
    expect(result.expectedRefusal).toBe(true)
    // If calibrated admission is added later, remove knownLimitation and move this case into the gated set.
    expect(result.refused).toBe(false)
    expect(result.checksPassed).toBe(false)
  })
})
