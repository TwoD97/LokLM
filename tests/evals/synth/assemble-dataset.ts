import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker } from '../pipeline/Chunker'
import type { GeneratedQuestion, SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

// assemble-dataset , CLI:
//   tsx tests/evals/synth/assemble-dataset.ts
//     --from-dir <questions-dir>
//     [--generator <name>]
//     [--out <path>]
//
// liest die sample-docs , chunked sie deterministisch , liest alle .jsonl
// dateien aus --from-dir (jede zeile: {"chunkId":"...","question":"..."}) ,
// filtert auf bekannte chunkIds und schreibt dataset.json.
//
// nützlich wenn die fragen extern erzeugt wurden (durch agents , durch ein
// anderes tool , durch hand-annotation) und nur noch ins dataset-format
// zusammengeführt werden müssen.

interface Dataset {
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
  questions: GeneratedQuestion[]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.fromDir) throw new Error('--from-dir pflichtig')

  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const docsDir = join(__dirname, '..', 'data', 'sample-docs')
  const docFiles = (await readdir(docsDir)).filter((f) => extname(f) === '.txt').sort()

  const chunks: SourceChunk[] = []
  for (const f of docFiles) {
    const text = await readFile(join(docsDir, f), 'utf-8')
    chunks.push(...chunker.chunk({ id: basename(f, '.txt'), text }))
  }
  const validIds = new Set(chunks.map((c) => c.id))
  console.error(`sample-docs: ${docFiles.length} , chunks: ${chunks.length}`)

  const questionFiles = (await readdir(args.fromDir)).filter((f) => extname(f) === '.jsonl').sort()
  console.error(`question-files: ${questionFiles.length}`)

  const questions: GeneratedQuestion[] = []
  let badLines = 0
  let unknownIds = 0
  for (const f of questionFiles) {
    const raw = await readFile(join(args.fromDir, f), 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let obj: { chunkId?: unknown; question?: unknown } | null = null
      try {
        obj = JSON.parse(trimmed) as { chunkId?: unknown; question?: unknown }
      } catch {
        badLines++
        continue
      }
      if (typeof obj.chunkId !== 'string' || typeof obj.question !== 'string') {
        badLines++
        continue
      }
      if (!validIds.has(obj.chunkId)) {
        unknownIds++
        continue
      }
      questions.push({ chunkId: obj.chunkId, question: obj.question })
    }
  }

  console.error(`fragen: ${questions.length} (${badLines} bad lines , ${unknownIds} unknown ids)`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const generator = args.generator ?? 'manual-or-agent'
  const safeProvider = generator.replace(/[^a-z0-9]+/gi, '-')
  const outDir = join(__dirname, '..', 'data', 'datasets')
  await mkdir(outDir, { recursive: true })
  const outPath = args.out ?? join(outDir, `${safeProvider}-${stamp}.json`)

  const dataset: Dataset = {
    generator,
    generatedAt: new Date().toISOString(),
    chunker: chunker.name,
    chunks,
    questions,
  }
  await writeFile(outPath, JSON.stringify(dataset, null, 2), 'utf-8')
  console.error(`geschrieben: ${outPath}`)
}

function parseArgs(argv: string[]): { fromDir?: string; generator?: string; out?: string } {
  const out: { fromDir?: string; generator?: string; out?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--from-dir' && next !== undefined) {
      out.fromDir = next
      i++
    } else if (a === '--generator' && next !== undefined) {
      out.generator = next
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = next
      i++
    }
  }
  return out
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
