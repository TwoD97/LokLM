import type { ElectronApplication } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as checkedAnswer from '@main/services/qa/checkedAnswer'
import { installCalibrationWorkerCapture } from '../e2e/helpers/syntheticCapture'

describe('synthetic capture schema bootstrap', () => {
  afterEach(() => vi.restoreAllMocks())

  it('passes exact current full and summary templates with bounded private capture enabled', async () => {
    const evaluate = vi.fn().mockResolvedValue({ disposed: false, pending: 0 })
    const app = { evaluate } as unknown as ElectronApplication
    await expect(installCalibrationWorkerCapture(app, '/owned/synthetic-profile')).resolves.toEqual(
      {
        disposed: false,
        pending: 0,
      },
    )
    expect(evaluate).toHaveBeenCalledTimes(1)
    const config = evaluate.mock.calls[0]![1].options
    expect(config.normalizeSourceEnum).toBe(true)
    expect(config.captureSourceLabelShapes).toBe(true)
    const full = JSON.parse(config.expectedSchemaJson)
    const summary = JSON.parse(config.alternateExpectedSchemaJson)
    expect(full.properties.result.oneOf).toHaveLength(3)
    expect(summary.properties.result.oneOf).toHaveLength(2)
    expect(summary.properties.result.oneOf[0]).toEqual(full.properties.result.oneOf[0])
    const variant = summary.properties.result.oneOf[1]
    expect(Object.keys(variant.properties)).toEqual(['resolution', 'summary', 'outcome'])
    expect(variant.properties.outcome).toEqual({ const: 'unresolved' })
    const body = variant.properties.summary
    expect(Object.keys(body.properties)).toEqual(['scope', 'alternatives', 'grounds'])
    expect(body.properties.scope.items.properties.text.minLength).toBe(1)
    expect(body.properties.scope.items.properties.text.maxLength).toBe(160)
    expect(body.properties.scope).toMatchObject({
      minItems: 1,
      maxItems: 3,
      items: { properties: { source: { enum: ['1:1'] } } },
    })
    expect(body.properties.alternatives).toMatchObject({ minItems: 2, maxItems: 4 })
    expect(body.properties.alternatives.items.properties.label).toEqual({
      oneOf: [
        { type: 'string', minLength: 1, maxLength: 80 },
        {
          type: 'object',
          properties: { kind: { const: 'heading' } },
          required: ['kind'],
          additionalProperties: false,
        },
      ],
    })
    expect(body.properties.grounds).toMatchObject({ minItems: 1, maxItems: 3 })
    expect(variant.properties).not.toHaveProperty('evidence')
    expect(config).not.toHaveProperty('historicalExcerptBudgets')
    expect(config).not.toHaveProperty('historicalExcerptPolicy')
    expect(JSON.stringify(config)).not.toContain('An inert synthetic source.')
  })

  it.each([
    { comparisonMode: 'concise', conciseUnitCount: 1 },
    { comparisonMode: 'excerpts', conciseUnitCount: 0 },
    { comparisonMode: 'excerpts', conciseUnitCount: 1 },
    { comparisonMode: 'summary', conciseUnitCount: 1 },
    { comparisonMode: 'summary', conciseFallbackReason: 'segmentation' },
    { comparisonMode: 'summary', summaryMaxCodePoints: null },
    { comparisonMode: 'summary', summaryMaxCodePoints: 0 },
    { comparisonMode: 'summary', summaryMaxCodePoints: 513 },
    { comparisonMode: 'summary', summaryMaxCodePoints: 1 },
    { comparisonMode: 'full', conciseUnitCount: 1 },
    { comparisonMode: 'full', conciseFallbackReason: 'source_bounds' },
    { comparisonMode: 'full', summaryMaxCodePoints: 1 },
  ])('refuses stale or mixed plan metadata before installing: %j', async (invalid) => {
    const original = checkedAnswer.buildCheckedContextBundle
    vi.spyOn(checkedAnswer, 'buildCheckedContextBundle').mockImplementation((...args) => {
      const bundle = original(...args)
      const target = invalid.comparisonMode === 'full' ? 'full' : 'summary'
      if (bundle.comparisonPlan?.comparisonMode !== target) return bundle
      return {
        ...bundle,
        comparisonPlan: { ...bundle.comparisonPlan, ...invalid },
      } as ReturnType<typeof original>
    })
    const evaluate = vi.fn()
    await expect(
      installCalibrationWorkerCapture({ evaluate } as unknown as ElectronApplication, '/owned'),
    ).rejects.toThrow('Synthetic capture schema unavailable')
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('refuses matching metadata and schema limits that differ from the captured catalog allowance', async () => {
    const original = checkedAnswer.buildCheckedContextBundle
    vi.spyOn(checkedAnswer, 'buildCheckedContextBundle').mockImplementation((...args) => {
      const bundle = original(...args)
      if (bundle.comparisonPlan?.comparisonMode !== 'summary') return bundle
      const alteredLimit = bundle.comparisonPlan.summaryMaxCodePoints! + 1
      const schema = structuredClone(bundle.comparisonPlan.jsonSchema)
      const summaryBranch = schema.properties.result.oneOf.find(
        (branch) => 'summary' in branch.properties,
      )!
      if (!('summary' in summaryBranch.properties)) throw new Error('Summary schema absent')
      Object.assign(summaryBranch.properties.summary.properties.scope.items.properties.text, {
        maxLength: alteredLimit,
      })
      return {
        ...bundle,
        comparisonPlan: {
          ...bundle.comparisonPlan,
          summaryMaxCodePoints: alteredLimit,
          jsonSchema: schema,
        },
      }
    })
    const evaluate = vi.fn()
    await expect(
      installCalibrationWorkerCapture({ evaluate } as unknown as ElectronApplication, '/owned'),
    ).rejects.toThrow('Synthetic capture schema unavailable')
    expect(evaluate).not.toHaveBeenCalled()
  })
})
