import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_ROOT,
  isCalibrationSplit,
  loadCalibrationSplit,
} from '../evals/native-calibration/fixtures'

describe('October 5 presealed reasoning challenge', () => {
  it('preserves the original seal and admits every source through byte validation', async () => {
    const split = 'reasoning-reserved-20261005'
    const sealBytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.sha256.json`))
    expect(createHash('sha256').update(sealBytes).digest('hex')).toBe(
      '0b828e0eb1427fc4e0f1abc63c9fb87b9d9399e7a29cba0f1695bc4280b0b6cd',
    )
    const seal = JSON.parse(sealBytes.toString('utf8'))
    expect(Object.keys(seal.files)).toHaveLength(19)
    const manifest = await loadCalibrationSplit(split)
    expect(manifest.cases).toHaveLength(12)
    expect(manifest.sources).toHaveLength(18)
    expect(new Set(manifest.cases.map((item) => item.id)).size).toBe(12)
    const sourceKeys = new Set(manifest.sources.map((item) => item.key))
    expect(sourceKeys.size).toBe(18)
    const referenceFormattingMismatches: string[] = []
    for (const item of manifest.cases) {
      for (const key of item.requiredSourceKeys) expect(sourceKeys.has(key)).toBe(true)
      for (const check of item.answerChecks) {
        if (!new RegExp(check.pattern, 'iu').test(item.referenceAnswer))
          referenceFormattingMismatches.push(`${item.id}: ${check.label}`)
      }
    }
    // The original sealed references contain joined words/numbers. Preserve
    // and disclose their exact defects instead of silently editing gold after
    // candidate freeze. These strings are never supplied to the model.
    expect(referenceFormattingMismatches).toEqual([
      'reasoning-reserved-05: current contribution',
      'reasoning-reserved-06: morning count',
      'reasoning-reserved-06: evening count',
      'reasoning-reserved-07: water',
      'reasoning-reserved-08: north result',
      'reasoning-reserved-08: south result',
      'reasoning-reserved-09: total',
      'reasoning-reserved-11: rate',
    ])
  })

  it('keeps source identities separate from the prior known corpora', async () => {
    const challenge = await loadCalibrationSplit('reasoning-reserved-20261005')
    for (const split of [
      'dev',
      'heldout',
      'authority-dev-20261002',
      'authority-reserved-20261002',
    ] as const) {
      const known = await loadCalibrationSplit(split)
      const keys = new Set(known.sources.map((source) => source.key))
      const files = new Set(known.sources.map((source) => source.file))
      for (const source of challenge.sources) {
        expect(keys.has(source.key)).toBe(false)
        expect(files.has(source.file)).toBe(false)
      }
    }
    expect(isCalibrationSplit('reasoning-reserved-20261005')).toBe(true)
    expect(isCalibrationSplit('../reasoning-reserved-20261005')).toBe(false)
  })
})
