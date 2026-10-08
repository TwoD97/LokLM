import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from '@main/services/documents/chunker'
import { parseMarkdownSections } from '@main/services/documents/markdownParser'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import type { RetrievalHit } from '@shared/documents'
import {
  CALIBRATION_ROOT,
  isCalibrationSplit,
  loadCalibrationSplit,
} from '../evals/native-calibration/fixtures'

const split = 'authority-transfer-20261005'
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('fresh four-case authority-transfer corpus', () => {
  it('retains every original sealed byte, including the renamed manual grading key', async () => {
    const sealBytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.seal.json`))
    expect(sha(sealBytes)).toBe('f991fa11cfcea10a1bac631f4d474371ec2261b87e3db1c4750a23acd4708cb8')
    const seal = JSON.parse(sealBytes.toString()) as { files: Record<string, string> }
    expect(Object.keys(seal.files)).toHaveLength(14)
    for (const [originalFile, expected] of Object.entries(seal.files)) {
      const currentFile = originalFile === 'grading.json' ? `${split}.grading.json` : originalFile
      expect(sha(await readFile(resolve(CALIBRATION_ROOT, currentFile))), originalFile).toBe(
        expected,
      )
    }
    expect(sha(await readFile(resolve(CALIBRATION_ROOT, `${split}.json`)))).toBe(
      '4b6ba07fdea36ed1d92e20128f54324533e0417f356c87135b70a33dedbc737d',
    )
  })

  it('loads all twelve documents for four bilingual cases, without gold-source filtering', async () => {
    expect(isCalibrationSplit(split)).toBe(true)
    const manifest = await loadCalibrationSplit(split)
    expect(manifest.sources).toHaveLength(12)
    expect(manifest.cases).toHaveLength(4)
    expect(new Set(manifest.sources.map((source) => source.key)).size).toBe(12)
    expect(new Set(manifest.cases.map((item) => item.id)).size).toBe(4)
    expect(manifest.cases.filter((item) => item.expectedAbstention)).toHaveLength(1)
    for (const language of ['en', 'de'])
      expect(manifest.cases.filter((item) => item.language === language)).toHaveLength(2)
    const required = new Set(manifest.cases.flatMap((item) => item.requiredSourceKeys))
    expect(required.size).toBe(8)
    expect(manifest.sources.filter((source) => !required.has(source.key))).toHaveLength(4)
    for (const item of manifest.cases) {
      expect(item.requiredSourceKeys).toHaveLength(2)
      expect(item.allowPartial).toBe(false)
      for (const key of item.requiredSourceKeys)
        expect(manifest.sources.some((source) => source.key === key)).toBe(true)
      for (const check of item.answerChecks)
        expect(new RegExp(check.pattern, 'iu').test(item.referenceAnswer), item.id).toBe(true)
    }
  })

  it('keeps source files and identities separate from prior challenge inputs', async () => {
    const prior = await loadCalibrationSplit('reasoning-reserved-20261005')
    const fresh = await loadCalibrationSplit(split)
    const keys = new Set(prior.sources.map((source) => source.key))
    const paths = new Set(prior.sources.map((source) => source.absolutePath))
    for (const source of fresh.sources) {
      expect(keys.has(source.key)).toBe(false)
      expect(paths.has(source.absolutePath)).toBe(false)
    }
  })

  it('preserves twelve intact chunks and admits all supplied passages in the 8K checked planner', async () => {
    const manifest = await loadCalibrationSplit(split)
    const hits: RetrievalHit[] = await Promise.all(
      manifest.sources.map(async (source, index) => {
        const chunks = chunkMarkdown(
          parseMarkdownSections(await readFile(source.absolutePath, 'utf8')),
          {
            maxChars: 2000,
            overlap: 200,
          },
        )
        expect(chunks).toHaveLength(1)
        const chunk = chunks[0]!
        return {
          document_id: index + 1,
          chunk_id: index + 1,
          document_title: source.title,
          text: chunk.text,
          ordinal: chunk.ordinal,
          page_from: chunk.pageFrom,
          page_to: chunk.pageTo,
          heading_path: chunk.headingPath,
          language: null,
          score: 1,
        }
      }),
    )
    for (const item of manifest.cases) {
      const plan = planAnswerContext({
        contextTokens: 8192,
        question: item.question,
        language: item.language,
        hits,
        answerMode: 'checked',
      })
      expect(plan.fits, item.id).toBe(true)
      expect(plan.hits, item.id).toEqual(hits)
    }
  })
})
