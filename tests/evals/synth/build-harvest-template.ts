// build-harvest-template , erzeugt ein YAML-template aus einem chunks-file
// damit dominik (oder wer auch immer fragen schreibt) zu jedem chunk 0..3
// fragen handschriftlich eintragen kann , ohne JSON von hand zu schreiben.
//
// Workflow:
//   1. input: existierendes chunks-file (oder eine andere dataset.json — die
//      chunks werden extrahiert)
//   2. output: YAML mit pro-chunk-block:
//        - chunkId: chunking-strategien::5
//          text: |
//            Strukturiertes Chunking nutzt …
//          # Schreibe hier 0-3 fragen. Jede frage soll AUSSCHLIESSLICH von
//          # diesem chunk beantwortbar sein (focused). Wenn die frage mehrere
//          # chunks braucht , setze intent: broad und liste die unter
//          # requiredChunkIds (chunk-ids aus dieser datei).
//          questions: []
//   3. dominik füllt das YAML
//   4. compile-step (compile-harvest.ts) liest das YAML zurück und erzeugt
//      ein dataset.json kompatibel zum eval-pipeline
//
// CLI (template-build , dieses script):
//   tsx tests/evals/synth/build-harvest-template.ts
//     --chunks-from <path>     pfad zu einem existing dataset/chunks file
//     [--output <path>]        default: data/staging/harvest-template-<stamp>.yaml
//     [--max-chunks <n>]       cap auf wieviele chunks im template (default: alle)
//
// Hinweis: wir haben kein YAML-lib im repo. Output ist deshalb plain text
// mit handgeschriebenem YAML , gut genug für menschen-edit. Das spätere
// compile-script muss aber einen YAML-parser haben — der kommt im
// compile-harvest.ts dazu (yaml package as devDep).

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface SourceChunk {
  id: string
  docId: string
  text: string
}

interface Args {
  chunksFrom: string
  output?: string
  maxChunks?: number
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--chunks-from' && next !== undefined) {
      out.chunksFrom = next
      i++
    } else if (a === '--output' && next !== undefined) {
      out.output = next
      i++
    } else if (a === '--max-chunks' && next !== undefined) {
      out.maxChunks = Number(next)
      i++
    }
  }
  if (!out.chunksFrom) throw new Error('--chunks-from <path> ist required')
  return out as Args
}

/** Escape für YAML literal block (pipe |). Indent jede zeile um 4 spaces.
 *  Das ist ausreichend für unsere chunks die nur text enthalten — keine
 *  yaml-special-chars im text-body relevant , weil literal-block alles
 *  wörtlich übernimmt. */
function yamlLiteralBlock(text: string, indent: string): string {
  const lines = text.split(/\r?\n/)
  return lines.map((l) => `${indent}${l}`).join('\n')
}

/** Escape für YAML scalar (single-line). Wir nutzen single-quoted-strings
 *  damit nur ein character escaped werden muss: das single-quote selbst
 *  (verdoppeln). */
function yamlSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.chunksFrom)) {
    throw new Error(`--chunks-from path doesn't exist: ${args.chunksFrom}`)
  }
  const raw = await readFile(args.chunksFrom, 'utf-8')
  const data = JSON.parse(raw) as { chunks: SourceChunk[]; chunker?: string }
  if (!Array.isArray(data.chunks)) {
    throw new Error(`expected JSON with a 'chunks' array , got: ${typeof data.chunks}`)
  }

  let chunks = data.chunks
  if (args.maxChunks !== undefined && args.maxChunks > 0 && chunks.length > args.maxChunks) {
    console.error(`[harvest-tpl] capping to first ${args.maxChunks} of ${chunks.length} chunks`)
    chunks = chunks.slice(0, args.maxChunks)
  }

  // Gruppieren nach docId für lesbarkeit im editor.
  const byDoc = new Map<string, SourceChunk[]>()
  for (const c of chunks) {
    if (!byDoc.has(c.docId)) byDoc.set(c.docId, [])
    byDoc.get(c.docId)!.push(c)
  }

  const lines: string[] = []
  lines.push(`# Harvest template , generiert ${new Date().toISOString()}`)
  lines.push(`# source: ${args.chunksFrom}`)
  lines.push(`# chunks: ${chunks.length} aus ${byDoc.size} docs`)
  lines.push(`#`)
  lines.push(`# Format pro chunk:`)
  lines.push(`#   - chunkId: <id>`)
  lines.push(`#     text: |`)
  lines.push(`#       <chunk-text>`)
  lines.push(`#     questions:`)
  lines.push(`#       - q: 'Was ist X?'`)
  lines.push(`#         intent: focused        # default ; weglassen ist ok`)
  lines.push(`#       - q: 'Vergleiche A und B.'`)
  lines.push(`#         intent: broad`)
  lines.push(`#         requiredChunkIds: ['doc::3', 'doc::4']`)
  lines.push(`#       - q: 'Fasse das ganze thema zusammen.'`)
  lines.push(`#         intent: summary`)
  lines.push(`#         requiredChunkIds: ['doc::0', 'doc::3', 'doc::7']`)
  lines.push(`#`)
  lines.push(`# Compile zurück zu dataset.json via:`)
  lines.push(`#   pnpm tsx tests/evals/synth/compile-harvest.ts --input <this-file>`)
  lines.push(`#`)
  lines.push(`chunker: ${data.chunker ?? 'unknown'}`)
  lines.push(`chunks:`)

  for (const [docId, docChunks] of byDoc.entries()) {
    lines.push('')
    lines.push(`  # ============================================================`)
    lines.push(`  # doc: ${docId} (${docChunks.length} chunks)`)
    lines.push(`  # ============================================================`)
    for (const c of docChunks) {
      lines.push(`  - chunkId: ${yamlSingleQuoted(c.id)}`)
      lines.push(`    docId: ${yamlSingleQuoted(c.docId)}`)
      lines.push(`    text: |`)
      lines.push(yamlLiteralBlock(c.text, '      '))
      lines.push(`    questions: []  # 0-3 fragen hier eintragen`)
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath =
    args.output ?? join(__dirname, '..', 'data', 'staging', `harvest-template-${stamp}.yaml`)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, lines.join('\n') + '\n', 'utf-8')
  console.error(`[harvest-tpl] written: ${outPath}`)
  console.error(`[harvest-tpl]   ${chunks.length} chunks aus ${byDoc.size} docs , 0 fragen (leer)`)
  console.error(`[harvest-tpl] jetzt im editor öffnen , fragen eintragen , dann:`)
  console.error(`  pnpm tsx tests/evals/synth/compile-harvest.ts --input ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
