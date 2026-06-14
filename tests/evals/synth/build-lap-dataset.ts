// build-lap-dataset , CLI + testbare Funktion.
//   tsx tests/evals/synth/build-lap-dataset.ts
//     --corpus <dir>           (default: tests/evals/data/lap-corpus)
//     --questions <jsonl>      (pflicht: kuratierte fragen, eine pro zeile)
//     [--out <path>]
//
// Liest alle .txt/.md-Dateien im korpus-dir, chunked deterministisch
// (referenz-chunker 512/64, mit char-offsets), liest die fragen-jsonl,
// filtert auf bekannte chunkIds, löst pro frage goldSpans aus den (required)
// chunk-offsets auf und schreibt das dataset im bestehenden
// {chunks, questions}-format — angereichert um spans.

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker, type Chunker } from '../pipeline/Chunker'
import { requiredChunkSet, type GeneratedQuestion, type SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface LapDataset {
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
  questions: GeneratedQuestion[]
}

interface RawQuestion {
  chunkId?: unknown
  question?: unknown
  requiredChunkIds?: unknown
  intent?: unknown
  lang?: unknown
  expectedRefusal?: unknown
  expectedAnswerSubstring?: unknown
}

const REFERENCE_CHUNKER = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })

export async function buildLapDataset(opts: {
  corpusDir: string
  questionsPath: string
  chunker?: Chunker
  generator?: string
  generatedAt?: string
}): Promise<LapDataset> {
  const chunker = opts.chunker ?? REFERENCE_CHUNKER
  const docFiles = (await readdir(opts.corpusDir))
    .filter((f) => extname(f) === '.txt' || extname(f) === '.md')
    .sort()
  const chunks: SourceChunk[] = []
  for (const f of docFiles) {
    const text = await readFile(join(opts.corpusDir, f), 'utf-8')
    chunks.push(...chunker.chunk({ id: basename(f, extname(f)), text }))
  }
  const chunkById = new Map(chunks.map((c) => [c.id, c] as const))

  const raw = await readFile(opts.questionsPath, 'utf-8')
  const questions: GeneratedQuestion[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let obj: RawQuestion
    try {
      obj = JSON.parse(trimmed) as RawQuestion
    } catch {
      continue
    }
    if (typeof obj.chunkId !== 'string' || typeof obj.question !== 'string') continue
    if (!chunkById.has(obj.chunkId)) continue

    const q: GeneratedQuestion = { chunkId: obj.chunkId, question: obj.question }
    if (Array.isArray(obj.requiredChunkIds)) {
      const valid = obj.requiredChunkIds.filter(
        (x): x is string => typeof x === 'string' && chunkById.has(x),
      )
      if (valid.length > 0) q.requiredChunkIds = valid
    }
    if (obj.intent === 'focused' || obj.intent === 'broad' || obj.intent === 'summary') {
      q.intent = obj.intent
    }
    if (obj.lang === 'de' || obj.lang === 'en') q.lang = obj.lang
    if (typeof obj.expectedRefusal === 'boolean') q.expectedRefusal = obj.expectedRefusal
    if (typeof obj.expectedAnswerSubstring === 'string') {
      q.expectedAnswerSubstring = obj.expectedAnswerSubstring
    }

    const goldSpans = requiredChunkSet(q)
      .map((id) => chunkById.get(id))
      .filter(
        (c): c is SourceChunk => c !== undefined && c.start !== undefined && c.end !== undefined,
      )
      .map((c) => ({ docId: c.docId, start: c.start!, end: c.end! }))
    if (goldSpans.length > 0) q.goldSpans = goldSpans

    questions.push(q)
  }

  return {
    generator: opts.generator ?? 'lap-converter',
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    chunker: chunker.name,
    chunks,
    questions,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.questions) throw new Error('--questions <jsonl> ist pflicht')
  const corpusDir = args.corpus ?? join(__dirname, '..', 'data', 'lap-corpus')
  const ds = await buildLapDataset({ corpusDir, questionsPath: args.questions })
  console.error(`korpus: ${ds.chunks.length} chunks , fragen: ${ds.questions.length}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(__dirname, '..', 'data', 'datasets')
  await mkdir(outDir, { recursive: true })
  const outPath = args.out ?? join(outDir, `lap-${stamp}.json`)
  await writeFile(outPath, JSON.stringify(ds, null, 2), 'utf-8')
  console.error(`geschrieben: ${outPath}`)
}

function parseArgs(argv: string[]): { corpus?: string; questions?: string; out?: string } {
  const out: { corpus?: string; questions?: string; out?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--corpus' && next !== undefined) {
      out.corpus = next
      i++
    } else if (a === '--questions' && next !== undefined) {
      out.questions = next
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = next
      i++
    }
  }
  return out
}

// Nur als CLI ausführen, nicht beim import aus dem test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
