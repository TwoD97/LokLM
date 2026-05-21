import 'dotenv/config'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker } from '../pipeline/Chunker'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { OllamaGenerator } from './OllamaGenerator'
import { AnthropicGenerator } from './AnthropicGenerator'
import type { GeneratedQuestion, QuestionGenerator, SourceChunk } from './QuestionGenerator'

// generate-dataset , CLI:
//   tsx tests/evals/synth/generate-dataset.ts [--provider ollama|anthropic] [--per-chunk N]
//
// liest tests/evals/data/sample-docs/*.txt , chunked sie , lässt den
// gewählten provider N fragen pro chunk generieren , schreibt
// tests/evals/data/datasets/<provider>-<datestamp>.json.

interface Dataset {
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
  questions: GeneratedQuestion[]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const provider = args.provider ?? 'ollama'
  const perChunk = args.perChunk ?? 3

  const generator = buildGenerator(provider)
  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })

  const docsDir = join(__dirname, '..', 'data', 'sample-docs')
  const outDir = join(__dirname, '..', 'data', 'datasets')
  await mkdir(outDir, { recursive: true })

  // .sort() so --limit N picks the same subset across filesystems (NTFS
  // returns sorted names, POSIX does not). assemble-dataset.ts already does
  // this — matching here keeps the two synth entrypoints reproducible.
  const docFiles = (await readdir(docsDir)).filter((f) => extname(f) === '.txt').sort()
  if (docFiles.length === 0) {
    throw new Error(`keine .txt dokumente unter ${docsDir}`)
  }

  const allChunks: SourceChunk[] = []
  for (const f of docFiles) {
    const text = await readFile(join(docsDir, f), 'utf-8')
    allChunks.push(...chunker.chunk({ id: basename(f, '.txt'), text }))
  }

  console.error(`generator: ${generator.name}`)
  console.error(`dokumente: ${docFiles.length} , chunks: ${allChunks.length}`)

  const questions: GeneratedQuestion[] = []
  for (const [i, chunk] of allChunks.entries()) {
    console.error(`[${i + 1}/${allChunks.length}] ${chunk.id}`)
    const qs = await generator.generate(chunk, perChunk)
    questions.push(...qs)
  }

  const dataset: Dataset = {
    generator: generator.name,
    generatedAt: new Date().toISOString(),
    chunker: chunker.name,
    chunks: allChunks,
    questions,
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeProvider = generator.name.replace(/[^a-z0-9]+/gi, '-')
  const outPath = join(outDir, `${safeProvider}-${stamp}.json`)
  await writeFile(outPath, JSON.stringify(dataset, null, 2), 'utf-8')
  console.error(`geschrieben: ${outPath}`)
  console.error(`fragen: ${questions.length}`)
}

function parseArgs(argv: string[]): { provider?: string; perChunk?: number } {
  const out: { provider?: string; perChunk?: number } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--provider' && next !== undefined) {
      out.provider = next
      i++
    } else if (a === '--per-chunk' && next !== undefined) {
      out.perChunk = Number(next)
      i++
    }
  }
  return out
}

function buildGenerator(provider: string): QuestionGenerator {
  if (provider === 'ollama') return new OllamaGenerator()
  if (provider === 'anthropic') return new AnthropicGenerator()
  throw new Error(`unbekannter provider: ${provider}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
