import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadCalibrationSplit } from '../evals/native-calibration/fixtures'

describe('native calibration corpus integrity', () => {
  it.each(['dev', 'heldout'] as const)(
    '%s has twelve auditable cases and six usable sources',
    async (split) => {
      const manifest = await loadCalibrationSplit(split)
      expect(manifest.cases).toHaveLength(12)
      expect(manifest.sources).toHaveLength(6)
      const keys = new Set(manifest.sources.map((source) => source.key))
      expect(keys.size).toBe(6)
      expect(new Set(manifest.cases.map((item) => item.id)).size).toBe(12)
      expect(manifest.sources.filter((source) => source.format === 'pdf')).toHaveLength(1)
      expect(new Set(manifest.cases.map((item) => item.language))).toEqual(new Set(['en', 'de']))
      expect(manifest.cases.filter((item) => item.kind === 'missing-fact')).toHaveLength(2)
      expect(manifest.cases.filter((item) => item.kind === 'conflicting-sources')).toHaveLength(1)
      expect(manifest.cases.filter((item) => item.expectedAbstention)).toHaveLength(3)
      for (const item of manifest.cases) {
        expect(item.id.startsWith(`${split}-`)).toBe(true)
        expect(item.allowPartial).toBe(false)
        for (const key of item.requiredSourceKeys)
          expect(keys.has(key), `${item.id}: ${key}`).toBe(true)
        for (const check of item.answerChecks) {
          expect(
            new RegExp(check.pattern, 'iu').test(item.referenceAnswer),
            `${item.id}: ${check.label}`,
          ).toBe(true)
        }
        if (!item.expectedAbstention) {
          expect(item.requiredSourceKeys.length).toBeGreaterThan(0)
          expect(item.answerChecks.length).toBeGreaterThan(0)
        }
        if (['multi-document-comparison', 'conflicting-sources'].includes(item.kind)) {
          expect(item.requiredSourceKeys).toHaveLength(2)
        }
      }
      for (const source of manifest.sources) {
        const bytes = await readFile(source.absolutePath)
        expect(bytes.length).toBeGreaterThan(150)
        if (source.format === 'pdf') {
          expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.4')
          expect(bytes.toString()).toContain('xref\n')
          expect(bytes.toString()).toContain('/Type /Page ')
        }
      }
    },
  )

  it('keeps documents, source identities and synthetic entities disjoint across splits', async () => {
    const dev = await loadCalibrationSplit('dev')
    const heldout = await loadCalibrationSplit('heldout')
    const developmentKeys = new Set(dev.sources.map((source) => source.key))
    const developmentFiles = new Set(dev.sources.map((source) => source.absolutePath))
    for (const source of heldout.sources) {
      expect(developmentKeys.has(source.key)).toBe(false)
      expect(developmentFiles.has(source.absolutePath)).toBe(false)
      expect((await readFile(source.absolutePath)).toString()).not.toMatch(
        /Mica|Selka|Qerlan|Neral|Bexin/u,
      )
    }
    for (const source of dev.sources) {
      expect((await readFile(source.absolutePath)).toString()).not.toMatch(
        /Veldrin|Orvo|Fenrik|Teral|Luvon/u,
      )
    }
  })
})
