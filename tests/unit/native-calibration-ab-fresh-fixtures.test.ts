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

const split = 'ab-fresh-validation-20261006'
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('post-freeze AB transfer fixture integrity', () => {
  it('preserves the original seal, manifest, source and grading bytes without transport rewriting', async () => {
    const bytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.seal.json`))
    expect(sha(bytes)).toBe('4db317746b07e5ae82ab230559240a5e7ad12da8c474a0f5e5ada85af23e6447')
    const seal = JSON.parse(bytes.toString()) as {
      files: Record<string, string>
      createdAt: string
      candidateSourceFreeze: string
    }
    expect(Object.keys(seal.files)).toHaveLength(10)
    expect(Date.parse(seal.createdAt)).toBeGreaterThan(Date.parse(seal.candidateSourceFreeze))
    for (const [file, digest] of Object.entries(seal.files))
      expect(sha(await readFile(resolve(CALIBRATION_ROOT, file))), file).toBe(digest)
    expect(sha(await readFile(resolve(CALIBRATION_ROOT, `${split}.json`)))).toBe(
      'ed528d83dabef454480e1a4714e9890cdbb175be7cde7c42162889850ab8e95d',
    )
  })

  it('hash-locks exactly the three-case manifest and all eight shared sources', async () => {
    const bytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.sha256.json`))
    expect(sha(bytes)).toBe('90f1316c9e7642b124603432d11b49214a7411ec62b000e6409c325067b63ff8')
    const lock = JSON.parse(bytes.toString()) as {
      originalSealSha256: string
      files: Record<string, string>
    }
    const manifest = await loadCalibrationSplit(split)
    expect(Object.keys(lock.files).sort()).toEqual(
      [`${split}.json`, ...manifest.sources.map((source) => source.file)].sort(),
    )
    expect(lock.originalSealSha256).toBe(
      sha(await readFile(resolve(CALIBRATION_ROOT, `${split}.seal.json`))),
    )
  })

  it('registers complete bilingual questions and fixed reference checks without gold-source filtering', async () => {
    expect(isCalibrationSplit(split)).toBe(true)
    const manifest = await loadCalibrationSplit(split)
    expect(manifest.sources).toHaveLength(8)
    expect(manifest.cases.map((item) => item.id)).toEqual([
      'ab-fresh-01',
      'ab-fresh-02',
      'ab-fresh-03',
    ])
    expect(new Set(manifest.sources.map((source) => source.key)).size).toBe(8)
    expect(new Set(manifest.cases.map((item) => item.language))).toEqual(new Set(['en', 'de']))
    expect(manifest.cases.filter((item) => item.expectedAbstention)).toHaveLength(1)
    const known = new Set(manifest.sources.map((source) => source.key))
    for (const item of manifest.cases) {
      expect(item.allowPartial).toBe(false)
      expect(item.requiredSourceKeys.every((key) => known.has(key))).toBe(true)
      for (const check of item.answerChecks)
        expect(new RegExp(check.pattern, 'iu').test(item.referenceAnswer), item.id).toBe(true)
    }
  })

  it('keeps all authored sources within the predeclared shared-corpus limits', async () => {
    const manifest = await loadCalibrationSplit(split)
    const texts = await Promise.all(
      manifest.sources.map((source) => readFile(source.absolutePath, 'utf8')),
    )
    expect(texts.every((text) => text.length <= 700)).toBe(true)
    expect(texts.reduce((sum, text) => sum + text.length, 0)).toBeLessThanOrEqual(4500)
    const prior = await loadCalibrationSplit('reasoning-reserved-20261005')
    const paths = new Set(prior.sources.map((source) => source.absolutePath))
    expect(manifest.sources.every((source) => !paths.has(source.absolutePath))).toBe(true)
  })

  it('preserves one chunk per source and fits every supplied source through the actual 8K checked planner', async () => {
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
      expect(
        plan.hits.map((hit) => hit.chunk_id),
        item.id,
      ).toEqual(hits.map((hit) => hit.chunk_id))
    }
  })
})
