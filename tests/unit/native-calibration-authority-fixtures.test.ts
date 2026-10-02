import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_ROOT,
  isCalibrationSplit,
  loadCalibrationSplit,
} from '../evals/native-calibration/fixtures'

describe('authority challenge development fixtures', () => {
  it('balances resolvable questions and abstentions across languages and challenge types', async () => {
    const manifest = await loadCalibrationSplit('authority-dev-20261002')
    expect(manifest.cases).toHaveLength(8)
    expect(manifest.sources).toHaveLength(15)
    expect(manifest.cases.filter((item) => item.expectedAbstention)).toHaveLength(3)
    expect(manifest.cases.filter((item) => item.language === 'en')).toHaveLength(4)
    expect(manifest.cases.filter((item) => item.language === 'de')).toHaveLength(4)
    expect(new Set(manifest.cases.map((item) => item.challengeCategory))).toEqual(
      new Set([
        'unresolved-numeric',
        'approved-supersession',
        'newer-unapproved',
        'different-scope-time',
        'equivalent-units',
        'missing-evidence',
        'unresolved-code',
        'corroborating-agreement',
      ]),
    )
    expect(new Set(manifest.cases.map((item) => item.id)).size).toBe(8)
    const sourceKeys = new Set(manifest.sources.map((source) => source.key))
    expect(sourceKeys.size).toBe(15)
    for (const item of manifest.cases) {
      expect(item.allowPartial).toBe(false)
      expect(item.requiredSourceKeys).toHaveLength(item.kind === 'missing-fact' ? 0 : 2)
      for (const key of item.requiredSourceKeys) expect(sourceKeys.has(key)).toBe(true)
      for (const check of item.answerChecks)
        expect(
          new RegExp(check.pattern, 'iu').test(item.referenceAnswer),
          `${item.id}: ${check.label}`,
        ).toBe(true)
    }
  })

  it('keeps each source short, readable and separate from historical corpora', async () => {
    const manifest = await loadCalibrationSplit('authority-dev-20261002')
    for (const source of manifest.sources) {
      const text = await readFile(source.absolutePath, 'utf8')
      expect(Buffer.byteLength(text)).toBeLessThan(2000)
      expect(text.trim().length).toBeGreaterThan(150)
      expect(text).not.toMatch(/Orvo|Veldrin|Mica|Selka|Qerlan|Arven|Belvar/u)
      expect(text).not.toContain('\uFFFD')
    }
  })

  it('preserves the original reserved seal and document-disjoint balanced cases after publication', async () => {
    const split = 'authority-reserved-20261002'
    // loadCalibrationSplit verifies every locked source and manifest byte hash.
    const reserved = await loadCalibrationSplit(split)
    const development = await loadCalibrationSplit('authority-dev-20261002')
    const lock = JSON.parse(
      await readFile(resolve(CALIBRATION_ROOT, `${split}.sha256.json`), 'utf8'),
    )
    expect(createHash('sha256').update(JSON.stringify(lock)).digest('hex')).toBe(
      'e18ae81aeeb0ff40b588c78824db44e9605b317ee50651a68c9d8e8d29008963',
    )
    expect(Object.keys(lock.files)).toHaveLength(16)
    expect(reserved.cases).toHaveLength(8)
    expect(reserved.sources).toHaveLength(15)
    expect(reserved.cases.filter((item) => item.expectedAbstention)).toHaveLength(3)
    expect(reserved.cases.filter((item) => item.language === 'en')).toHaveLength(4)
    expect(new Set(reserved.cases.map((item) => item.challengeCategory)).size).toBe(8)
    const developmentKeys = new Set(development.sources.map((item) => item.key))
    const developmentFiles = new Set(development.sources.map((item) => item.file))
    for (const source of reserved.sources) {
      expect(developmentKeys.has(source.key)).toBe(false)
      expect(developmentFiles.has(source.file)).toBe(false)
    }
    const sourceKeys = new Set(reserved.sources.map((item) => item.key))
    for (const item of reserved.cases) {
      expect(item.allowPartial).toBe(false)
      for (const key of item.requiredSourceKeys) expect(sourceKeys.has(key)).toBe(true)
      for (const check of item.answerChecks)
        expect(new RegExp(check.pattern, 'iu').test(item.referenceAnswer)).toBe(true)
    }
  })

  it('accepts only explicit split identifiers', () => {
    expect(isCalibrationSplit('authority-dev-20261002')).toBe(true)
    expect(isCalibrationSplit('authority-reserved-20261002')).toBe(true)
    expect(isCalibrationSplit('../reserved')).toBe(false)
    expect(isCalibrationSplit('authority-reserved')).toBe(false)
  })
})
