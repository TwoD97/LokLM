import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { extname, join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker } from '../pipeline/Chunker'
import type { SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

// dump-chunks , CLI:
//   tsx tests/evals/synth/dump-chunks.ts [--out <path>]
//
// liest tests/evals/data/sample-docs/*.txt , chunked sie mit fixed-512-64
// und schreibt die chunks als JSON. nützlich um den exakten chunk-satz an
// frage-generatoren (oder agents) als input zu geben.

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const outPath = args.out ?? join(__dirname, '..', 'data', 'staging', 'sample-doc-chunks.json')

  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const docsDir = join(__dirname, '..', 'data', 'sample-docs')
  const docFiles = (await readdir(docsDir)).filter((f) => extname(f) === '.txt').sort()

  const chunks: SourceChunk[] = []
  for (const f of docFiles) {
    const text = await readFile(join(docsDir, f), 'utf-8')
    chunks.push(...chunker.chunk({ id: basename(f, '.txt'), text }))
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify({ chunker: chunker.name, chunks }, null, 2), 'utf-8')
  console.error(`geschrieben: ${outPath}`)
  console.error(`dokumente: ${docFiles.length} , chunks: ${chunks.length}`)
}

function parseArgs(argv: string[]): { out?: string } {
  const out: { out?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--out' && next !== undefined) {
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
