import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkMarkdown, chunkPages } from '@main/services/documents/chunker'
import { parseMarkdownSections } from '@main/services/documents/markdownParser'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { RetrievalHit } from '@shared/documents'
import {
  CALIBRATION_ROOT,
  isCalibrationSplit,
  loadCalibrationSplit,
} from '../evals/native-calibration/fixtures'

const split = 's-fresh-validation-20261005'
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const originalSeal = '45280c60b61521d133ccad623712eed725fa69d2bbe0df734f27552cc088f010'

async function actualChunks() {
  const manifest = await loadCalibrationSplit(split)
  const options = {
    maxChars: DEFAULT_SETTINGS.retrieval.chunkSize,
    overlap: DEFAULT_SETTINGS.retrieval.chunkOverlap,
  }
  return Promise.all(
    manifest.sources.map(async (source) => {
      const text = await readFile(source.absolutePath, 'utf8')
      const chunks =
        source.format === 'text'
          ? chunkPages([{ num: 1, text }], options)
          : chunkMarkdown(parseMarkdownSections(text), options)
      return { source, text, chunks }
    }),
  )
}

describe('new three-case validation authored against frozen S', () => {
  it('preserves the original seal and every payload byte, including renamed grading protocol', async () => {
    const sealBytes = await readFile(resolve(CALIBRATION_ROOT, `${split}.seal.json`))
    expect(sha(sealBytes)).toBe(originalSeal)
    const seal = JSON.parse(sealBytes.toString('utf8')) as {
      buildManifestSha256: string
      files: Record<string, string>
    }
    expect(seal.buildManifestSha256).toBe(
      '8bf154b72b78cea6ca9b936c8279efbb37bb304674b691d7dbd51e7e8d0457c1',
    )
    expect(Object.keys(seal.files)).toHaveLength(11)
    for (const [originalFile, expected] of Object.entries(seal.files)) {
      const publishedFile = originalFile === 'GRADING.md' ? `${split}.GRADING.md` : originalFile
      const bytes = await readFile(resolve(CALIBRATION_ROOT, publishedFile))
      expect(sha(bytes), originalFile).toBe(expected)
      expect(bytes.includes(13), `${originalFile} must retain LF bytes`).toBe(false)
    }
    const lock = JSON.parse(
      await readFile(resolve(CALIBRATION_ROOT, `${split}.sha256.json`), 'utf8'),
    ) as { files: Record<string, string> }
    expect(Object.keys(lock.files)).toHaveLength(9)
    await expect(loadCalibrationSplit(split)).resolves.toMatchObject({ split, schemaVersion: 1 })
  })

  it('keeps all three cases and eight documents, including all three scope distractors', async () => {
    expect(isCalibrationSplit(split)).toBe(true)
    expect(isCalibrationSplit(`../${split}`)).toBe(false)
    const manifest = await loadCalibrationSplit(split)
    expect(manifest.sources).toHaveLength(8)
    expect(manifest.cases.map((entry) => entry.id)).toEqual([
      's-fresh-01',
      's-fresh-02',
      's-fresh-03',
    ])
    expect(manifest.cases.filter((entry) => entry.expectedAbstention)).toHaveLength(1)
    expect(manifest.cases.filter((entry) => entry.language === 'de')).toHaveLength(2)
    expect(manifest.cases.filter((entry) => entry.language === 'en')).toHaveLength(1)
    const keys = new Set(manifest.sources.map((source) => source.key))
    expect(keys.size).toBe(8)
    const required = new Set(manifest.cases.flatMap((entry) => entry.requiredSourceKeys))
    expect(required.size).toBe(5)
    expect(manifest.sources.filter((source) => !required.has(source.key))).toHaveLength(3)
    for (const entry of manifest.cases) {
      expect(entry.allowPartial).toBe(false)
      for (const key of entry.requiredSourceKeys) expect(keys.has(key)).toBe(true)
      for (const check of entry.answerChecks)
        expect(
          new RegExp(check.pattern, 'iu').test(entry.referenceAnswer),
          `${entry.id}: ${check.label}`,
        ).toBe(true)
    }
  })

  it('keeps both conflicting statements together in one actual plaintext chunk', async () => {
    const manifest = await loadCalibrationSplit(split)
    const conflict = manifest.cases[0]!
    expect(conflict.requiredSourceKeys).toHaveLength(1)
    const source = (await actualChunks()).find(
      (entry) => entry.source.key === conflict.requiredSourceKeys[0],
    )!
    expect(source.source.format).toBe('text')
    expect(source.chunks).toHaveLength(1)
    expect(source.chunks[0]!.text).toBe(source.text.trim())
    for (const check of conflict.answerChecks)
      expect(new RegExp(check.pattern, 'iu').test(source.chunks[0]!.text), check.label).toBe(true)
  })

  it('admits the complete eight-source corpus through the actual 8K checked planner', async () => {
    const manifest = await loadCalibrationSplit(split)
    const chunked = await actualChunks()
    const hits: RetrievalHit[] = chunked.map(({ source, chunks }, index) => {
      expect(chunks, source.key).toHaveLength(1)
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
    })
    for (const entry of manifest.cases) {
      const plan = planAnswerContext({
        contextTokens: 8192,
        question: entry.question,
        language: entry.language,
        hits,
        answerMode: 'checked',
      })
      expect(plan.fits, entry.id).toBe(true)
      expect(plan.hits, entry.id).toEqual(hits)
    }
  })

  it('keeps source identities, paths and document bytes separate from both earlier October5 corpora', async () => {
    const fresh = await loadCalibrationSplit(split)
    const freshHashes = await Promise.all(
      fresh.sources.map(async (source) => sha(await readFile(source.absolutePath))),
    )
    for (const priorSplit of [
      'reasoning-reserved-20261005',
      'authority-transfer-20261005',
    ] as const) {
      const prior = await loadCalibrationSplit(priorSplit)
      const keys = new Set(prior.sources.map((source) => source.key))
      const paths = new Set(prior.sources.map((source) => source.absolutePath))
      const hashes = new Set(
        await Promise.all(
          prior.sources.map(async (source) => sha(await readFile(source.absolutePath))),
        ),
      )
      for (const [index, source] of fresh.sources.entries()) {
        expect(keys.has(source.key)).toBe(false)
        expect(paths.has(source.absolutePath)).toBe(false)
        expect(hashes.has(freshHashes[index]!)).toBe(false)
      }
    }
  })
})
