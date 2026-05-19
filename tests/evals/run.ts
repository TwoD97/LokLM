import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultConfigs } from './pipeline/configs'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { evalConfig, type FullReport } from './evalRunner'
import type { GeneratedQuestion, SourceChunk } from './synth/QuestionGenerator'

// run , CLI:
//   tsx tests/evals/run.ts [--dataset <path>] [--library <path>]
//                          [--config <name>] [--k 10]
//
// ohne --dataset wird das jüngste file unter data/datasets/ genommen.
// mit --library wird der korpus um die distractor-chunks erweitert.
// ohne --config laufen alle defaultConfigs() durch.

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const datasetPath = args.dataset ?? (await latestDataset())
  const topK = args.k ?? 10

  const dataset = JSON.parse(await readFile(datasetPath, 'utf-8')) as Dataset
  console.error(`dataset: ${datasetPath}`)
  console.error(`chunks: ${dataset.chunks.length} , fragen: ${dataset.questions.length}`)

  let library: Library | null = null
  let corpus: SourceChunk[] = dataset.chunks
  if (args.library) {
    library = JSON.parse(await readFile(args.library, 'utf-8')) as Library
    corpus = [...dataset.chunks, ...library.chunks]
    console.error(`library: ${args.library} (${library.size} , ${library.chunks.length} chunks)`)
    console.error(`korpus gesamt: ${corpus.length} chunks`)
  }

  const configs = defaultConfigs().filter((c) => !args.config || c.name === args.config)
  if (configs.length === 0) {
    throw new Error(`keine config matcht --config=${args.config}`)
  }

  const reports: FullReport[] = []
  for (const cfg of configs) {
    console.error(`\nconfig: ${cfg.name}`)
    const report = await evalConfig(cfg, {
      questions: dataset.questions,
      corpus,
      topK,
    })
    reports.push(report)
    console.error(formatReport(report))
  }

  await writeReport(reports, dataset, library)
}

function formatReport(r: FullReport): string {
  return [
    `  n=${r.eval.numQueries}`,
    `  recall@1  = ${r.eval.recallAt1.toFixed(3)}`,
    `  recall@5  = ${r.eval.recallAt5.toFixed(3)}`,
    `  recall@10 = ${r.eval.recallAt10.toFixed(3)}`,
    `  MRR       = ${r.eval.mrr.toFixed(3)}`,
    `  nDCG@10   = ${r.eval.ndcgAt10.toFixed(3)}`,
    `  query p50 = ${r.perf.query.p50.toFixed(1)} ms , p95 = ${r.perf.query.p95.toFixed(1)} ms`,
    `  build     = ${r.perf.buildMs.toFixed(0)} ms , mem ≈ ${r.perf.memoryAfterRunMiB.toFixed(0)} MiB`,
  ].join('\n')
}

async function writeReport(
  reports: FullReport[],
  dataset: Dataset,
  library: Library | null,
): Promise<void> {
  const outDir = join(__dirname, 'report')
  await mkdir(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const json = {
    dataset: dataset.generator,
    generatedAt: dataset.generatedAt,
    library: library ? { size: library.size, chunks: library.chunks.length } : null,
    reports,
  }
  await writeFile(join(outDir, `${stamp}.json`), JSON.stringify(json, null, 2), 'utf-8')
  await writeFile(join(outDir, `${stamp}.md`), formatMarkdown(reports, dataset, library), 'utf-8')
  console.error(`\nreport: ${join(outDir, `${stamp}.md`)}`)
}

function formatMarkdown(reports: FullReport[], dataset: Dataset, library: Library | null): string {
  const header = [
    `# Eval-Report`,
    ``,
    `- Dataset-Generator: ${dataset.generator}`,
    `- Dataset-Stamp: ${dataset.generatedAt}`,
    `- Chunker: ${dataset.chunker}`,
    `- Anzahl Fragen: ${dataset.questions.length}`,
    library
      ? `- Library: ${library.size} , ${library.chunks.length} chunks , generator ${library.generator}`
      : `- Library: keine`,
    ``,
    `| Config | n | recall@1 | recall@5 | recall@10 | MRR | nDCG@10 | query p50 ms | query p95 ms | build ms | mem MiB |`,
    `| ------ | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: |`,
  ]
  const rows = reports.map((r) =>
    [
      r.eval.config,
      r.eval.numQueries,
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
      .replace(/$/, ' |'),
  )
  return [...header, ...rows, ''].join('\n')
}

async function latestDataset(): Promise<string> {
  const dir = join(__dirname, 'data', 'datasets')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  if (files.length === 0)
    throw new Error(`keine datasets unter ${dir} , erst pnpm evals:generate laufen lassen`)
  files.sort()
  return join(dir, files[files.length - 1]!)
}

function parseArgs(argv: string[]): {
  dataset?: string
  library?: string
  config?: string
  k?: number
} {
  const out: { dataset?: string; library?: string; config?: string; k?: number } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--dataset' && next !== undefined) {
      out.dataset = next
      i++
    } else if (a === '--library' && next !== undefined) {
      out.library = next
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
