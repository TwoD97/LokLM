// salvage-focused-260 , taggt das anonyme agent-batch-claude-opus-4-7-260q
// dataset explizit als focused-intent + requiredChunkIds=[chunkId] und schreibt
// es als neues stable artifact unter data/datasets/.
//
// Das ursprüngliche file (agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json)
// hat 260 fragen über 52 chunks (5 q pro chunk , 3 docs: rag-grundlagen ,
// eval-metriken , loklm-architektur). Die GeneratedQuestion-helper haben
// fallback-defaults , aber wir wollen für den scale-up einen explizit
// getaggten artifact damit zukünftige tools nicht stillschweigend auf
// implizite defaults verlassen sind.
//
// Sanity-check: jede 5er-gruppe muss exakt 5 fragen über DENSELBEN chunk
// haben , sonst ist die single-relevant-annahme falsch und wir müssen
// die fragen einzeln prüfen.
//
// CLI:
//   tsx tests/evals/synth/salvage-focused-260.ts
//     [--input <path>]    default: agent-batch-claude-opus-4-7-...latest
//     [--output <path>]   default: data/datasets/focused-260q-<stamp>.json

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GeneratedQuestion, SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface InputQuestion {
  chunkId: string
  question: string
  intent?: string
  requiredChunkIds?: string[]
}

interface InputDataset {
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
  questions: InputQuestion[]
}

interface Args {
  input?: string
  output?: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--input' && next !== undefined) {
      out.input = next
      i++
    } else if (a === '--output' && next !== undefined) {
      out.output = next
      i++
    }
  }
  return out
}

async function findLatestAgentBatch(): Promise<string | null> {
  const dir = join(__dirname, '..', 'data', 'datasets')
  const files = (await readdir(dir)).filter(
    (f) => f.startsWith('agent-batch-') && f.endsWith('.json'),
  )
  if (files.length === 0) return null
  files.sort()
  return join(dir, files[files.length - 1]!)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = args.input ?? (await findLatestAgentBatch())
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error(
      `no input dataset found ; pass --input <path> or place an agent-batch-*.json in data/datasets/`,
    )
  }
  const raw = await readFile(inputPath, 'utf-8')
  const input = JSON.parse(raw) as InputDataset

  console.error(`[salvage] input: ${inputPath}`)
  console.error(`[salvage]   chunks: ${input.chunks.length} , questions: ${input.questions.length}`)

  // Sanity 1: jede question.chunkId muss in chunks vorhanden sein.
  const chunkIds = new Set(input.chunks.map((c) => c.id))
  const missing = input.questions.filter((q) => !chunkIds.has(q.chunkId))
  if (missing.length > 0) {
    console.error(`[salvage] FEHLER: ${missing.length} questions verweisen auf fehlende chunks`)
    for (const q of missing.slice(0, 5))
      console.error(`  - ${q.chunkId}: ${q.question.slice(0, 60)}`)
    process.exit(1)
  }
  console.error(`[salvage] sanity 1 OK: alle chunkIds auflösbar`)

  // Sanity 2: verteilung pro chunk soll ~uniform sein (originator hat 5 q/chunk
  // generiert). Wenn ein chunk 0 fragen hat oder >>5 , ist die assumption locker.
  const counts = new Map<string, number>()
  for (const q of input.questions) {
    counts.set(q.chunkId, (counts.get(q.chunkId) ?? 0) + 1)
  }
  const histogram = new Map<number, number>()
  for (const n of counts.values()) {
    histogram.set(n, (histogram.get(n) ?? 0) + 1)
  }
  console.error(`[salvage] sanity 2 (questions per chunk):`)
  for (const [n, c] of [...histogram.entries()].sort((a, b) => a[0] - b[0])) {
    console.error(`  ${n} q/chunk: ${c} chunks`)
  }
  const chunksWithNoQuestions = input.chunks.filter((c) => !counts.has(c.id))
  if (chunksWithNoQuestions.length > 0) {
    console.error(
      `[salvage] note: ${chunksWithNoQuestions.length} chunks have no questions (distractors , OK)`,
    )
  }

  // Augmentieren: jede frage bekommt explizit intent='focused' und
  // requiredChunkIds=[chunkId]. Frage und chunkId werden 1:1 übernommen.
  const augmented: GeneratedQuestion[] = input.questions.map((q) => ({
    chunkId: q.chunkId,
    question: q.question,
    intent: 'focused' as const,
    requiredChunkIds: [q.chunkId],
  }))

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath =
    args.output ?? join(__dirname, '..', 'data', 'datasets', `focused-260q-${stamp}.json`)

  const dataset = {
    generator: `salvage-focused:${input.generator}`,
    generatedAt: new Date().toISOString(),
    chunker: input.chunker,
    sourceFile: inputPath,
    salvageNote:
      'Alle 260 fragen explizit als intent=focused getaggt und requiredChunkIds=[chunkId] gesetzt. Annahme: 5 q pro chunk == single-relevant. Stichprobe vor production-use empfohlen.',
    chunks: input.chunks,
    questions: augmented,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(dataset, null, 2), 'utf-8')
  console.error(`[salvage] written: ${outPath}`)
  console.error(
    `[salvage]   chunks: ${dataset.chunks.length} , questions: ${dataset.questions.length} (all focused)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
