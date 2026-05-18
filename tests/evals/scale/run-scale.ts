import { readFile, readdir, mkdir, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultConfigs } from '../pipeline/configs'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { evalConfig, type FullReport } from '../evalRunner'
import type { GeneratedQuestion, SourceChunk } from '../synth/QuestionGenerator'

// run-scale , CLI:
//   tsx tests/evals/scale/run-scale.ts [--dataset <path>]
//                                      [--libraries tiny,small,medium,large]
//                                      [--config <name>]
//                                      [--k 10]
//
// fährt die eval für jede vorhandene library-stufe einmal durch und schreibt
// einen scaling-report. fehlende libraries werden geskippt mit hinweis.
//
// zusätzlich gibt es immer einen baseline-lauf "no library" der nur die
// dataset-chunks als korpus nimmt , damit die degradationskurve startpunkt hat.

const ALL_LIBRARIES = ['tiny', 'small', 'medium', 'large'] as const
type LibraryName = (typeof ALL_LIBRARIES)[number]

interface Dataset {
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
  questions: GeneratedQuestion[]
}

interface Library {
  size: string
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
}

interface ScaleRow {
  library: string
  libraryChunks: number
  corpusChunks: number
  report: FullReport
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const datasetPath = args.dataset ?? (await latestDataset())
  const topK = args.k ?? 10

  const dataset = JSON.parse(await readFile(datasetPath, 'utf-8')) as Dataset
  console.error(`dataset: ${datasetPath}`)
  console.error(`chunks: ${dataset.chunks.length} , fragen: ${dataset.questions.length}`)

  const configs = defaultConfigs().filter((c) => !args.config || c.name === args.config)
  if (configs.length === 0) {
    throw new Error(`keine config matcht --config=${args.config}`)
  }

  const wanted = args.libraries ?? [...ALL_LIBRARIES]
  const libDir = join(__dirname, '..', 'data', 'libraries')

  // baseline ohne library
  const stages: Array<{ name: string; library: Library | null }> = [
    { name: 'baseline', library: null },
  ]
  for (const name of wanted) {
    const path = join(libDir, `${name}.json`)
    if (!(await exists(path))) {
      console.error(`library ${name} nicht gefunden unter ${path} , skip`)
      continue
    }
    const lib = JSON.parse(await readFile(path, 'utf-8')) as Library
    stages.push({ name, library: lib })
  }

  const rows: ScaleRow[] = []
  for (const stage of stages) {
    const corpus = stage.library ? [...dataset.chunks, ...stage.library.chunks] : dataset.chunks
    const libraryChunks = stage.library ? stage.library.chunks.length : 0

    console.error(`\n=== stage: ${stage.name} (corpus ${corpus.length} chunks) ===`)
    for (const cfg of configs) {
      console.error(`  config: ${cfg.name}`)
      const report = await evalConfig(cfg, {
        questions: dataset.questions,
        corpus,
        topK,
      })
      rows.push({
        library: stage.name,
        libraryChunks,
        corpusChunks: corpus.length,
        report,
      })
      console.error(formatRowConsole(stage.name, corpus.length, report))
    }
  }

  await writeReport(rows, dataset)
}

function formatRowConsole(libraryName: string, corpusChunks: number, r: FullReport): string {
  return [
    `    [${libraryName} , corpus ${corpusChunks}]`,
    `    recall@10 = ${r.eval.recallAt10.toFixed(3)} , MRR = ${r.eval.mrr.toFixed(3)}`,
    `    query p50 = ${r.perf.query.p50.toFixed(1)} ms , p95 = ${r.perf.query.p95.toFixed(1)} ms , mem ≈ ${r.perf.memoryAfterRunMiB.toFixed(0)} MiB`,
  ].join('\n')
}

async function writeReport(rows: ScaleRow[], dataset: Dataset): Promise<void> {
  const outDir = join(__dirname, '..', 'report')
  await mkdir(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const json = {
    dataset: dataset.generator,
    generatedAt: dataset.generatedAt,
    rows,
  }
  await writeFile(join(outDir, `scale-${stamp}.json`), JSON.stringify(json, null, 2), 'utf-8')
  await writeFile(join(outDir, `scale-${stamp}.md`), formatMarkdown(rows, dataset), 'utf-8')
  console.error(`\nscale-report: ${join(outDir, `scale-${stamp}.md`)}`)
}

function formatMarkdown(rows: ScaleRow[], dataset: Dataset): string {
  const header = [
    `# Scale-Report`,
    ``,
    `- Dataset-Generator: ${dataset.generator}`,
    `- Dataset-Stamp: ${dataset.generatedAt}`,
    `- Anzahl Fragen: ${dataset.questions.length}`,
    ``,
    `| Library | Lib-Chunks | Corpus | Config | recall@1 | recall@5 | recall@10 | MRR | nDCG@10 | query p50 ms | query p95 ms | build ms | mem MiB |`,
    `| ------- | -: | -: | ------ | -: | -: | -: | -: | -: | -: | -: | -: | -: |`,
  ]
  const body = rows.map((row) => {
    const r = row.report
    return [
      row.library,
      row.libraryChunks,
      row.corpusChunks,
      r.eval.config,
      r.eval.recallAt1.toFixed(3),
      r.eval.recallAt5.toFixed(3),
      r.eval.recallAt10.toFixed(3),
      r.eval.mrr.toFixed(3),
      r.eval.ndcgAt10.toFixed(3),
      r.perf.query.p50.toFixed(1),
      r.perf.query.p95.toFixed(1),
      r.perf.buildMs.toFixed(0),
      r.perf.memoryAfterRunMiB.toFixed(0),
    ]
      .map(String)
      .join(' | ')
      .replace(/^/, '| ')
      .replace(/$/, ' |')
  })
  return [...header, ...body, ''].join('\n')
}

async function latestDataset(): Promise<string> {
  const dir = join(__dirname, '..', 'data', 'datasets')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  if (files.length === 0)
    throw new Error(`keine datasets unter ${dir} , erst pnpm evals:generate laufen lassen`)
  files.sort()
  return join(dir, files[files.length - 1]!)
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function parseArgs(argv: string[]): {
  dataset?: string
  libraries?: LibraryName[]
  config?: string
  k?: number
} {
  const out: {
    dataset?: string
    libraries?: LibraryName[]
    config?: string
    k?: number
  } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--dataset' && next !== undefined) {
      out.dataset = next
      i++
    } else if (a === '--libraries' && next !== undefined) {
      out.libraries = next.split(',').map((s) => s.trim()) as LibraryName[]
      i++
    } else if (a === '--config' && next !== undefined) {
      out.config = next
      i++
    } else if (a === '--k' && next !== undefined) {
      out.k = Number(next)
      i++
    }
  }
  return out
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
