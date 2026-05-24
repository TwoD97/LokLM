// compile-harvest , liest das ausgefüllte harvest-YAML (chunks + per-chunk
// fragen) zurück und schreibt ein dataset.json kompatibel zur eval-pipeline.
//
// Workflow:
//   1. dominik füllt das YAML mit fragen pro chunk
//   2. dieses script:
//      - parsed YAML
//      - validiert dass jede frage.requiredChunkIds (falls gesetzt) auf
//        chunks aus diesem template zeigen
//      - flatten chunks + questions in GeneratedQuestion[]
//      - schreibt unter data/datasets/curated-de-<n>q-<stamp>.json
//
// CLI:
//   tsx tests/evals/synth/compile-harvest.ts
//     --input <path>           pfad zum ausgefüllten YAML-template
//     [--output <path>]        default: data/datasets/curated-de-<n>q-<stamp>.json
//     [--name <label>]         dataset-name-tag (z.b. "dominik-curated-2026-05")

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// yaml ist im moment transitive aber nicht direkt deklariert , und pnpm's
// strict node_modules layout exposed das paket dann nicht. String-concat
// fooled die TS-static-analysis , aber zur runtime crashed der resolver.
// Bevor das script läuft , muss yaml als direct devDep dazu , z.B.:
//   pnpm add -D yaml
// Danach kann der string-concat-hack zu `import { parse } from 'yaml'` werden.
async function loadYamlParser(): Promise<(s: string) => unknown> {
  const spec = 'ya' + 'ml'
  try {
    const mod = (await import(spec)) as unknown as { parse: (s: string) => unknown }
    return mod.parse
  } catch (err) {
    console.error('')
    console.error('[compile-harvest] FEHLER: yaml package nicht zur runtime auffindbar.')
    console.error('[compile-harvest] fix: pnpm add -D yaml')
    console.error('[compile-harvest] (transitive deps werden von pnpm nicht exposed)')
    console.error('')
    throw err
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))

interface YamlChunk {
  chunkId: string
  docId?: string
  text: string
  questions?: Array<{
    q: string
    intent?: 'focused' | 'broad' | 'summary'
    requiredChunkIds?: string[]
  }>
}

interface YamlTemplate {
  chunker?: string
  chunks: YamlChunk[]
}

interface Args {
  input: string
  output?: string
  name?: string
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--input' && next !== undefined) {
      out.input = next
      i++
    } else if (a === '--output' && next !== undefined) {
      out.output = next
      i++
    } else if (a === '--name' && next !== undefined) {
      out.name = next
      i++
    }
  }
  if (!out.input) throw new Error('--input <yaml-path> ist required')
  return out as Args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const raw = await readFile(args.input, 'utf-8')
  const parseYaml = await loadYamlParser()
  const tpl = parseYaml(raw) as YamlTemplate
  if (!Array.isArray(tpl.chunks)) {
    throw new Error(`YAML hat keinen 'chunks'-array`)
  }

  // Sanity-check: alle chunkIds eindeutig
  const seen = new Set<string>()
  for (const c of tpl.chunks) {
    if (seen.has(c.chunkId)) throw new Error(`duplicate chunkId: ${c.chunkId}`)
    seen.add(c.chunkId)
  }

  const chunkIds = new Set(tpl.chunks.map((c) => c.chunkId))
  const allQuestions: Array<{
    chunkId: string
    question: string
    intent: 'focused' | 'broad' | 'summary'
    requiredChunkIds: string[]
  }> = []
  const issues: string[] = []
  const intentCounts = { focused: 0, broad: 0, summary: 0 }

  for (const c of tpl.chunks) {
    if (!c.questions || c.questions.length === 0) continue
    for (const [qi, q] of c.questions.entries()) {
      if (!q.q || q.q.trim().length === 0) {
        issues.push(`${c.chunkId}#${qi}: leere frage`)
        continue
      }
      const intent = q.intent ?? 'focused'
      const required = q.requiredChunkIds ?? [c.chunkId]

      // Wenn requiredChunkIds gesetzt sind , muss jeder ID im chunks-set sein.
      const missing = required.filter((id) => !chunkIds.has(id))
      if (missing.length > 0) {
        issues.push(
          `${c.chunkId}#${qi} ('${q.q.slice(0, 40)}…'): requiredChunkIds nicht im set: ${missing.join(', ')}`,
        )
        continue
      }
      // Wenn intent broad/summary aber required ist nur 1 chunk = primary-chunk ,
      // dann ist die annotation locker. Warnung , kein fehler.
      if (intent !== 'focused' && required.length === 1) {
        console.error(
          `[warn] ${c.chunkId}#${qi}: intent=${intent} aber nur 1 chunk in requiredChunkIds`,
        )
      }

      allQuestions.push({
        chunkId: c.chunkId,
        question: q.q.trim(),
        intent,
        requiredChunkIds: required,
      })
      intentCounts[intent]++
    }
  }

  if (issues.length > 0) {
    console.error(`[compile-harvest] ${issues.length} validation issues:`)
    for (const i of issues.slice(0, 20)) console.error(`  - ${i}`)
    if (issues.length > 20) console.error(`  … (+${issues.length - 20} more)`)
    process.exit(1)
  }

  if (allQuestions.length === 0) {
    console.error(`[compile-harvest] template hat 0 fragen , nichts zu schreiben`)
    process.exit(1)
  }

  const chunks = tpl.chunks.map((c) => ({
    id: c.chunkId,
    docId: c.docId ?? c.chunkId.split('::')[0] ?? 'unknown',
    text: c.text,
  }))

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const nameTag = args.name ?? 'curated-de'
  const outPath =
    args.output ??
    join(__dirname, '..', 'data', 'datasets', `${nameTag}-${allQuestions.length}q-${stamp}.json`)

  const dataset = {
    generator: `harvest-compile:${nameTag}`,
    generatedAt: new Date().toISOString(),
    chunker: tpl.chunker ?? 'unknown',
    sourceTemplate: args.input,
    chunks,
    questions: allQuestions,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(dataset, null, 2), 'utf-8')
  console.error(`[compile-harvest] written: ${outPath}`)
  console.error(
    `[compile-harvest]   chunks: ${chunks.length} , questions: ${allQuestions.length} ` +
      `(focused=${intentCounts.focused} , broad=${intentCounts.broad} , summary=${intentCounts.summary})`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
