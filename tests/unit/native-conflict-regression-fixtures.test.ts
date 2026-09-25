import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from '@main/services/documents/chunker'
import { parseMarkdownSections } from '@main/services/documents/markdownParser'
import { planAnswerContext } from '@main/services/qa/contextBudget'
import type { RetrievalHit } from '@shared/documents'
import { loadCalibrationSplit } from '../evals/native-calibration/fixtures'

describe('post-held-out conflict regression corpus', () => {
  it('requires uncertainty and an authorized answer in each language', async () => {
    const manifest = await loadCalibrationSplit('conflict-regression')
    expect(manifest.sources).toHaveLength(4)
    expect(manifest.cases).toHaveLength(4)
    expect(new Set(manifest.sources.map((source) => source.key)).size).toBe(4)
    expect(new Set(manifest.cases.map((item) => item.id)).size).toBe(4)
    for (const language of ['en', 'de']) {
      const cases = manifest.cases.filter((item) => item.language === language)
      expect(cases).toHaveLength(2)
      expect(cases.filter((item) => item.expectedAbstention)).toHaveLength(1)
      expect(cases.filter((item) => !item.expectedAbstention)).toHaveLength(1)
    }
    for (const item of manifest.cases) {
      expect(item.allowPartial).toBe(false)
      expect(item.requiredSourceKeys).toHaveLength(item.expectedAbstention ? 2 : 1)
      for (const check of item.answerChecks) {
        expect(new RegExp(check.pattern, 'iu').test(item.referenceAnswer)).toBe(true)
        expect(new RegExp(check.pattern, 'iu').test('The answer is unavailable.')).toBe(false)
      }
    }
  })

  it('preserves all four whole source passages through real chunking and 4K/8K packing', async () => {
    const manifest = await loadCalibrationSplit('conflict-regression')
    const hits: RetrievalHit[] = await Promise.all(
      manifest.sources.map(async (source, index) => {
        const text = await readFile(source.absolutePath, 'utf8')
        const chunks = chunkMarkdown(parseMarkdownSections(text), {
          maxChars: 2000,
          overlap: 200,
        })
        expect(chunks).toHaveLength(1)
        const chunk = chunks[0]!
        expect(chunk.text).not.toMatch(/answer in|antworte|source marker|Quellenmarker/iu)
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
    for (const contextTokens of [4096, 8192]) {
      for (const item of manifest.cases) {
        const plan = planAnswerContext({
          contextTokens,
          question: item.question,
          language: item.language,
          hits,
        })
        expect(plan.fits).toBe(true)
        expect(plan.hits).toEqual(hits)
        for (const sourceKey of item.requiredSourceKeys) {
          const documentId = manifest.sources.findIndex((source) => source.key === sourceKey) + 1
          expect(plan.hits.some((hit) => hit.document_id === documentId)).toBe(true)
        }
      }
    }
  })
})
