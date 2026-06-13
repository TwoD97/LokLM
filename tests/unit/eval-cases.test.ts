import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * AP-E.1 — Validator für das Eval-Dev-Set (eval/cases.json laut Pflichtenheft §8.5,
 * im Repo abgelegt als tests/evals/data/cases.jsonl).
 *
 * Der Test ist gleichzeitig der Loader, den AP-E.2 wiederverwenden kann: er prüft
 * Schema, Sprach- und Typ-Verteilung und — am wichtigsten — dass jede
 * expected_chunk_ids-Referenz im gechunkten Quelldokument existiert und jeder
 * expected_answer_substring dort wörtlich vorkommt. Quelle der Wahrheit für die
 * Chunk-Indizes ist sample-doc-chunks.json (Chunker: fixed-512-64).
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const casesPath = resolve(repoRoot, 'tests/evals/data/cases.jsonl')
const chunksPath = resolve(repoRoot, 'tests/evals/data/staging/sample-doc-chunks.json')
const holdoutPath = resolve(repoRoot, 'tests/evals/data/holdout/dominik-15.jsonl')

interface EvalCase {
  id: string
  lang: 'de' | 'en'
  workspace_seed: string[]
  question: string
  expected_chunk_ids: number[]
  expected_answer_substring: string | null
  expected_refusal: boolean
}

/** Whitespace identisch zu sample-doc-chunks.json-Dump kollabieren. */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

const docIdOf = (seedFile: string): string => seedFile.replace(/\.txt$/, '')

const typeOf = (id: string): 'ans' | 'ref' | 'par' | 'unknown' => {
  const prefix = id.split('-')[0]
  return prefix === 'ans' || prefix === 'ref' || prefix === 'par' ? prefix : 'unknown'
}

function loadJsonl(path: string): EvalCase[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), i }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, i }) => {
      try {
        return JSON.parse(line) as EvalCase
      } catch (e) {
        throw new Error(
          `cases.jsonl Zeile ${i + 1} ist kein gültiges JSON: ${(e as Error).message}`,
        )
      }
    })
}

// Chunk-Texte je Dokument als (normalisierter) Index -> Text laden.
const chunkData = JSON.parse(readFileSync(chunksPath, 'utf8')) as {
  chunker: string
  chunks: { id: string; docId: string; text: string }[]
}
const chunkText: Record<string, string[]> = {}
for (const c of chunkData.chunks) {
  const [docId, idxStr] = c.id.split('::')
  const idx = Number(idxStr)
  ;(chunkText[docId] ??= [])[idx] = norm(c.text)
}

const cases = loadJsonl(casesPath)

describe('AP-E.1 eval cases (cases.jsonl)', () => {
  it('pins the chunker the chunk indices are authored against', () => {
    expect(chunkData.chunker).toBe('fixed-512-64')
  })

  it('contains at least the 50 cases the DoD requires', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50)
    expect(cases.length).toBe(80)
  })

  it('has unique ids', () => {
    const ids = cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('hits the 30% DE / 70% EN language split', () => {
    const de = cases.filter((c) => c.lang === 'de').length
    const en = cases.filter((c) => c.lang === 'en').length
    expect(de).toBe(24)
    expect(en).toBe(56)
    expect(de + en).toBe(cases.length)
  })

  it('hits the 60% answerable / 25% refusal / 15% partial type split', () => {
    const ans = cases.filter((c) => typeOf(c.id) === 'ans').length
    const ref = cases.filter((c) => typeOf(c.id) === 'ref').length
    const par = cases.filter((c) => typeOf(c.id) === 'par').length
    expect(ans).toBe(48)
    expect(ref).toBe(20)
    expect(par).toBe(12)
    expect(ans + ref + par).toBe(cases.length)
  })

  describe.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    it('matches the required schema', () => {
      expect(typeof c.id).toBe('string')
      expect(['de', 'en']).toContain(c.lang)
      expect(Array.isArray(c.workspace_seed)).toBe(true)
      expect(c.workspace_seed.length).toBe(1)
      expect(typeof c.question).toBe('string')
      expect(c.question.trim().length).toBeGreaterThan(0)
      expect(Array.isArray(c.expected_chunk_ids)).toBe(true)
      expect(typeof c.expected_refusal).toBe('boolean')
    })

    it('uses a known sample-doc as workspace seed', () => {
      for (const seed of c.workspace_seed) {
        expect(seed.endsWith('.txt')).toBe(true)
        expect(chunkText[docIdOf(seed)]).toBeDefined()
      }
    })

    it('keeps the id type consistent with expected_refusal', () => {
      const t = typeOf(c.id)
      expect(t).not.toBe('unknown')
      // <type>-<lang>-<NNN>
      expect(c.id).toMatch(/^(ans|ref|par)-(de|en)-\d{3}$/)
      expect(c.id.split('-')[1]).toBe(c.lang)
      if (t === 'ref') expect(c.expected_refusal).toBe(true)
      else expect(c.expected_refusal).toBe(false)
    })

    if (typeOf(c.id) === 'ref') {
      it('is a clean refusal case (no chunks, no substring)', () => {
        expect(c.expected_chunk_ids).toEqual([])
        expect(c.expected_answer_substring).toBeNull()
        expect(c.expected_refusal).toBe(true)
      })
    } else {
      it('references valid chunk indices for its seeded doc', () => {
        const docId = docIdOf(c.workspace_seed[0])
        const chunks = chunkText[docId]
        expect(c.expected_chunk_ids.length).toBeGreaterThanOrEqual(1)
        for (const idx of c.expected_chunk_ids) {
          expect(Number.isInteger(idx)).toBe(true)
          expect(idx).toBeGreaterThanOrEqual(0)
          expect(idx).toBeLessThan(chunks.length)
          expect(chunks[idx]).toBeDefined()
        }
      })

      it('has an expected_answer_substring that literally occurs in a referenced chunk', () => {
        expect(typeof c.expected_answer_substring).toBe('string')
        const needle = norm(c.expected_answer_substring as string)
        expect(needle.length).toBeGreaterThan(0)
        const docId = docIdOf(c.workspace_seed[0])
        const haystack = c.expected_chunk_ids.map((idx) => chunkText[docId][idx]).join(' ')
        expect(haystack).toContain(needle)
      })
    }
  })

  // Echo-Kammer-Schutz (R5): wenn das versiegelte Hold-out im Baum liegt, darf
  // keine Dev-Frage wörtlich eine Hold-out-Frage doppeln.
  it('does not duplicate any sealed hold-out question (when present)', () => {
    if (!existsSync(holdoutPath)) return
    const holdoutQs = new Set(loadJsonl(holdoutPath).map((c) => norm(c.question.toLowerCase())))
    const collisions = cases
      .map((c) => norm(c.question.toLowerCase()))
      .filter((q) => holdoutQs.has(q))
    expect(collisions).toEqual([])
  })
})
