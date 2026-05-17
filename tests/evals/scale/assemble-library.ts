import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, basename, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker } from '../pipeline/Chunker'
import type { SourceChunk } from '../synth/QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

// assemble-library , CLI:
//   tsx tests/evals/scale/assemble-library.ts --size <size> --from-dir <path>
//                                             [--generator <name>] [--limit <n>]
//
// liest alle .txt files aus --from-dir , chunked sie mit fixed-512-64
// und schreibt tests/evals/data/libraries/<size>.json. nimmt nur so viele
// chunks bis der size-preset oder das optionale --limit erreicht ist.
//
// nützlich für zwei wege:
//   - real-world distractors , wenn man echte texte in den staging-ordner
//     legt statt sie zu generieren
//   - vorbereitete synth-docs , wenn ein agent oder ein anderes tool die
//     texte separat geschrieben hat (siehe scale/README.md)

interface Library {
  size: string
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
}

const SIZES: Record<string, number> = {
  tiny: 50,
  small: 500,
  medium: 5_000,
  large: 50_000,
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.size) throw new Error('--size pflichtig (tiny|small|medium|large)')
  if (!args.fromDir) throw new Error('--from-dir pflichtig')

  const target = args.limit ?? SIZES[args.size]
  if (target === undefined) throw new Error(`unbekannte size: ${args.size}`)

  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const files = (await readdir(args.fromDir)).filter((f) => extname(f) === '.txt').sort()
  if (files.length === 0) throw new Error(`keine .txt files unter ${args.fromDir}`)

  console.error(`from-dir: ${args.fromDir} , ${files.length} files`)
  console.error(`ziel: ${target} chunks , size: ${args.size}`)

  let chunks: SourceChunk[] = []
  let docsUsed = 0
  for (const f of files) {
    if (chunks.length >= target) break
    const text = (await readFile(join(args.fromDir, f), 'utf-8')).trim()
    if (text.length < 200) {
      console.error(`  skip ${f} (zu kurz , ${text.length} chars)`)
      continue
    }
    const docId = basename(f, '.txt')
    const newChunks = chunker.chunk({ id: docId, text })
    chunks.push(...newChunks)
    docsUsed++
    console.error(`  +${newChunks.length} chunks aus ${docId} (running total: ${chunks.length})`)
  }

  chunks = chunks.slice(0, target)
  const outDir = join(__dirname, '..', 'data', 'libraries')
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${args.size}.json`)
  const lib: Library = {
    size: args.size,
    generator: args.generator ?? 'manual-or-agent',
    generatedAt: new Date().toISOString(),
    chunker: chunker.name,
    chunks,
  }
  await writeFile(outPath, JSON.stringify(lib, null, 2), 'utf-8')
  console.error(`\ngeschrieben: ${outPath}`)
  console.error(`docs verbraucht: ${docsUsed} , chunks final: ${chunks.length}`)
}

function parseArgs(argv: string[]): {
  size?: string
  fromDir?: string
  generator?: string
  limit?: number
} {
  const out: { size?: string; fromDir?: string; generator?: string; limit?: number } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--size' && next !== undefined) {
      out.size = next
      i++
    } else if (a === '--from-dir' && next !== undefined) {
      out.fromDir = next
      i++
    } else if (a === '--generator' && next !== undefined) {
      out.generator = next
      i++
    } else if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    }
  }
  return out
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
