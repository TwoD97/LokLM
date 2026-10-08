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

const split = 'ar-fresh-validation-20261006'
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const originalSealHash = '41bf31d79018deb712434e0d8c7535991cab305de7a98732a9d32bdc201dec18'
const originalLockHash = '88aa04def102331c801a974ec674b3a38fdce91d7f1832ba4c6f6d46b1fd9e7f'

describe('AR pre-authorship frozen validation corpus integrity', () => {
  it('preserves the original manifest, key and all twenty source byte hashes', async () => {
    const bytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.seal.json`))
    expect(sha(bytes)).toBe(originalSealHash)
    const seal = JSON.parse(bytes.toString()) as {
      files: Record<string, string>
      authoredAt: string
      createdAt: string
      candidateSourceFreeze: string
      preAuthorshipFreezeSha256: string
      protocolSha256: string
    }
    expect(Object.keys(seal.files)).toHaveLength(23)
    expect(Date.parse(seal.authoredAt)).toBeGreaterThan(Date.parse(seal.candidateSourceFreeze))
    expect(Date.parse(seal.createdAt)).toBeGreaterThanOrEqual(Date.parse(seal.authoredAt))
    expect(seal.preAuthorshipFreezeSha256).toBe(
      'e6fec777d7cfe7aed3f7e6e6da761b417ffe0a3397c6179399c55c2585e85512',
    )
    expect(seal.protocolSha256).toBe(
      '76456106b149f79160098079f162bac0974ffb8afe99ea4dfbad58536349c4ff',
    )
    for (const [file, digest] of Object.entries(seal.files)) {
      const payload = await readFile(resolve(CALIBRATION_ROOT, file))
      expect(sha(payload), file).toBe(digest)
      expect(payload.includes(13), file).toBe(false)
    }
  })

  it('locks exactly the manifest and shared corpus without treating the grading key as model input', async () => {
    const bytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.sha256.json`))
    expect(sha(bytes)).toBe(originalLockHash)
    const lock = JSON.parse(bytes.toString()) as {
      originalSealSha256: string
      files: Record<string, string>
    }
    const manifest = await loadCalibrationSplit(split)
    expect(Object.keys(lock.files).sort()).toEqual(
      [`${split}.json`, ...manifest.sources.map((source) => source.file)].sort(),
    )
    expect(lock.originalSealSha256).toBe(originalSealHash)
    expect(Object.keys(lock.files)).toHaveLength(21)
  })

  it('retains all eight cases, the frozen language distribution and complete source requirements', async () => {
    expect(isCalibrationSplit(split)).toBe(true)
    const manifest = await loadCalibrationSplit(split)
    expect(manifest.sources).toHaveLength(20)
    expect(new Set(manifest.sources.map((source) => source.key)).size).toBe(20)
    expect(manifest.cases.map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `ar-fresh-${String(index + 1).padStart(2, '0')}`),
    )
    expect(manifest.cases.map((item) => item.language)).toEqual([
      'de',
      'en',
      'de',
      'en',
      'en',
      'de',
      'de',
      'en',
    ])
    expect(manifest.cases.filter((item) => item.expectedAbstention)).toHaveLength(3)
    const known = new Set(manifest.sources.map((source) => source.key))
    for (const item of manifest.cases) {
      expect(item.allowPartial, item.id).toBe(false)
      expect(item.requiredSourceKeys.length, item.id).toBeGreaterThanOrEqual(1)
      expect(item.requiredSourceKeys.length, item.id).toBeLessThanOrEqual(3)
      expect(
        item.requiredSourceKeys.every((key) => known.has(key)),
        item.id,
      ).toBe(true)
      expect([...item.question].length, item.id).toBeLessThanOrEqual(300)
      expect(Buffer.byteLength(item.question), item.id).toBeLessThanOrEqual(450)
      for (const check of item.answerChecks)
        expect(new RegExp(check.pattern, 'iu').test(item.referenceAnswer), item.id).toBe(true)
    }
  })

  it('satisfies the complete shared-corpus byte bounds and preserves genuine distractors', async () => {
    const manifest = await loadCalibrationSplit(split)
    const texts = await Promise.all(manifest.sources.map((source) => readFile(source.absolutePath)))
    const total = texts.reduce((sum, text) => sum + text.length, 0)
    expect(total).toBeGreaterThanOrEqual(5000)
    expect(total).toBeLessThanOrEqual(7000)
    expect(texts.every((text) => text.length <= 700)).toBe(true)
    const needed = new Set(manifest.cases.flatMap((item) => item.requiredSourceKeys))
    const irrelevant = manifest.sources.filter((source) => !needed.has(source.key))
    expect(irrelevant).toHaveLength(4)
    const key = JSON.parse(
      await readFile(resolve(CALIBRATION_ROOT, `${split}.grading.json`), 'utf8'),
    ) as {
      distractorSourceKeys: string[]
      cases: Array<{ caseId: string; required: Record<string, string[]> }>
    }
    expect(key.distractorSourceKeys.sort()).toEqual(irrelevant.map((source) => source.key).sort())
    for (const item of manifest.cases) {
      const rule = key.cases.find((entry) => entry.caseId === item.id)
      expect(rule).toBeDefined()
      expect(Object.keys(rule!.required).sort()).toEqual([...item.requiredSourceKeys].sort())
    }
  })

  it('keeps every complete source through the unchanged checked 8K planner for every question', async () => {
    const manifest = await loadCalibrationSplit(split)
    const hits: RetrievalHit[] = await Promise.all(
      manifest.sources.map(async (source, index) => {
        const chunks = chunkMarkdown(
          parseMarkdownSections(await readFile(source.absolutePath, 'utf8')),
          { maxChars: 2000, overlap: 200 },
        )
        expect(chunks.length, source.key).toBe(1)
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
      expect(plan.maxTokens, item.id).toBe(2176)
      expect(plan.hits, item.id).toEqual(hits)
      expect(plan.comparisonPlan).toBeDefined()
    }
  })
})
