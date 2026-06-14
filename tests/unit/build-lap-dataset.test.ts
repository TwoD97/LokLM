import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLapDataset } from '../evals/synth/build-lap-dataset'

let dir: string
let corpusDir: string
let questionsPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lap-test-'))
  corpusDir = join(dir, 'corpus')
  mkdirSync(corpusDir)
  // zwei kleine docs; alpha hat >1 chunk bei size 50/overlap 10 (step 40)
  writeFileSync(join(corpusDir, 'alpha.txt'), 'A'.repeat(120), 'utf-8')
  writeFileSync(join(corpusDir, 'beta.txt'), 'B'.repeat(30), 'utf-8')
  questionsPath = join(dir, 'questions.jsonl')
  writeFileSync(
    questionsPath,
    [
      JSON.stringify({
        chunkId: 'alpha::0',
        question: 'Frage 1?',
        lang: 'de',
        expectedRefusal: false,
      }),
      JSON.stringify({ chunkId: 'beta::0', question: 'Q2?', lang: 'en' }),
      JSON.stringify({ chunkId: 'does-not-exist::9', question: 'dropped?' }),
      '   ',
      'not json',
    ].join('\n'),
    'utf-8',
  )
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('buildLapDataset', () => {
  it('chunks the corpus with char offsets', async () => {
    const ds = await buildLapDataset({
      corpusDir,
      questionsPath,
      chunker: new (await import('../evals/pipeline/Chunker')).FixedSizeChunker({
        name: 'fixed-50-10',
        size: 50,
        overlap: 10,
      }),
      generatedAt: '2026-06-14T00:00:00.000Z',
    })
    const alpha0 = ds.chunks.find((c) => c.id === 'alpha::0')
    expect(alpha0).toBeDefined()
    expect(alpha0!.start).toBe(0)
    expect(alpha0!.end).toBe(50)
  })

  it('resolves goldSpans from the source chunk and drops unknown/invalid lines', async () => {
    const ds = await buildLapDataset({
      corpusDir,
      questionsPath,
      chunker: new (await import('../evals/pipeline/Chunker')).FixedSizeChunker({
        name: 'fixed-50-10',
        size: 50,
        overlap: 10,
      }),
      generatedAt: '2026-06-14T00:00:00.000Z',
    })
    // 2 gültige fragen; unknown id + blank + 'not json' fallen raus
    expect(ds.questions).toHaveLength(2)
    const q1 = ds.questions.find((q) => q.chunkId === 'alpha::0')!
    expect(q1.lang).toBe('de')
    expect(q1.expectedRefusal).toBe(false)
    expect(q1.goldSpans).toEqual([{ docId: 'alpha', start: 0, end: 50 }])
    expect(ds.generatedAt).toBe('2026-06-14T00:00:00.000Z')
  })
})
