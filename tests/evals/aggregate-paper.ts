// aggregate-paper.ts — sammelt alle sweep-run-dirs ein und schreibt eine flache ,
// zitierfähige paper-tabelle als CSV (pandas/excel) + LaTeX-longtable (\input ins
// manuskript). Jede zeile trägt provenienz: git-sha , dirty-flag , CPU , RAM ,
// dataset-sha256 — siehe Paper-Regeln in ANLEITUNG-DOMINIK.md.
//
// CLI:
//   tsx tests/evals/aggregate-paper.ts [--runs <dir>] [--out <dir>] [--clean-only]
//
//   --runs       wurzel der run-dirs (default tests/evals/report/runs)
//   --out        zielordner für paper-table.csv/.tex (default tests/evals/report)
//   --clean-only nur runs mit sauberem arbeitsbaum (env.git.dirty === false)
//
// Pack-aggregate (run-pack.ts) haben KEIN dataset-feld im summary.json und werden
// übersprungen — wir wollen nur die sweep-form.

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// EINE quelle der wahrheit für die spalten-reihenfolge — CSV-header UND
// LaTeX-spalten leiten sich hieraus ab , können also nie auseinanderlaufen.
export const COLUMNS = [
  'dataset',
  'config',
  'n',
  'recall@5',
  'recall@10',
  'recall_req@5',
  'recall_req@12',
  'MRR',
  'nDCG@10',
  'judge',
  'correctness',
  'groundedness',
  'helpfulness',
  'TTFT-p50',
  'composite',
  'git-sha',
  'dirty',
  'CPU',
  'RAM',
  'dataset-sha256',
] as const

export type Column = (typeof COLUMNS)[number]
export type Row = Record<Column, string>

// --- shapes (teilmenge dessen was sweep.ts/runDir.ts pro run schreiben) ---
interface JudgeAvg {
  score: number
  correctness: number
  groundedness: number
  helpfulness: number
}
export interface ConfigResult {
  config: string
  numQueries: number
  recallAt5: number
  recallAt10: number
  recallRequiredAt5: number
  recallRequiredAt12: number
  mrr: number
  ndcgAt10: number
  phased: { ttft: { p50: number } }
  judgeAvg: JudgeAvg | null
  composite: number
}
export interface DatasetInfo {
  path: string
  sha256: string
}
export interface SweepSummary {
  results: ConfigResult[]
  dataset: DatasetInfo
}
export interface EnvSnapshot {
  git: { shortSha: string; dirty: boolean }
  hardware: { cpuModel: string; totalRamGB: number }
}

/** Sweep-summary trägt ein `dataset`-feld ; pack-summary (pack/results/failures/
 *  skipped) nicht. Daran unterscheiden wir die beiden formen — pack wird im
 *  aggregator übersprungen. */
export function isSweepSummary(j: unknown): j is SweepSummary {
  return (
    typeof j === 'object' &&
    j !== null &&
    'dataset' in j &&
    'results' in j &&
    Array.isArray((j as { results: unknown }).results)
  )
}

/** basename cross-platform — dataset.path kann ein Windows-pfad sein , auch wenn
 *  der aggregator auf Linux läuft (RunPod). node:path.basename würde auf Linux
 *  einen `\`-pfad nicht splitten , daher selbst auf beide trenner splitten. */
export function baseName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}

const f3 = (n: number): string => n.toFixed(3)

export function toRow(result: ConfigResult, dataset: DatasetInfo, env: EnvSnapshot): Row {
  const j = result.judgeAvg
  return {
    dataset: baseName(dataset.path),
    config: result.config,
    n: String(result.numQueries),
    'recall@5': f3(result.recallAt5),
    'recall@10': f3(result.recallAt10),
    'recall_req@5': f3(result.recallRequiredAt5),
    'recall_req@12': f3(result.recallRequiredAt12),
    MRR: f3(result.mrr),
    'nDCG@10': f3(result.ndcgAt10),
    judge: j ? f3(j.score) : '-',
    correctness: j ? f3(j.correctness) : '-',
    groundedness: j ? f3(j.groundedness) : '-',
    helpfulness: j ? f3(j.helpfulness) : '-',
    'TTFT-p50': (result.phased?.ttft?.p50 ?? 0).toFixed(0),
    composite: f3(result.composite),
    'git-sha': env.git.shortSha,
    dirty: String(env.git.dirty),
    CPU: env.hardware.cpuModel,
    RAM: String(env.hardware.totalRamGB),
    'dataset-sha256': dataset.sha256,
  }
}

// --- CSV ---
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(rows: Row[]): string {
  const header = COLUMNS.join(',')
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))
  return [header, ...body].join('\n') + '\n'
}

// --- LaTeX (booktabs longtable) ---
export function escapeLatex(s: string): string {
  return s
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}
export function toLatex(rows: Row[]): string {
  const colspec = COLUMNS.map(() => 'l').join('')
  const head = COLUMNS.map((c) => `\\textbf{${escapeLatex(c)}}`).join(' & ')
  const body = rows.map((r) => COLUMNS.map((c) => escapeLatex(r[c])).join(' & ') + ' \\\\')
  return [
    '% auto-generiert von tests/evals/aggregate-paper.ts — nicht von hand editieren',
    `\\begin{longtable}{${colspec}}`,
    '\\toprule',
    `${head} \\\\`,
    '\\midrule',
    '\\endhead',
    ...body,
    '\\bottomrule',
    '\\end{longtable}',
    '',
  ].join('\n')
}

// --- I/O (läuft nur beim direkten aufruf , nicht beim import im test) ---
interface Args {
  runs: string
  out: string
  cleanOnly: boolean
}
function parseArgs(argv: string[]): Args {
  const out: Args = {
    runs: join(__dirname, 'report', 'runs'),
    out: join(__dirname, 'report'),
    cleanOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--runs' && next !== undefined) {
      out.runs = resolve(next)
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = resolve(next)
      i++
    } else if (a === '--clean-only') {
      out.cleanOnly = true
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.runs)) {
    console.error(`keine runs unter ${args.runs} — erst pnpm evals:matrix laufen lassen`)
    return
  }
  const entries = await readdir(args.runs, { withFileTypes: true })
  const sortable: Array<{ ds: string; composite: number; row: Row }> = []
  let runDirs = 0
  let skipPack = 0
  let skipDirty = 0
  let skipIncomplete = 0
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = join(args.runs, e.name)
    const sp = join(dir, 'summary.json')
    const ep = join(dir, 'env.json')
    if (!existsSync(sp) || !existsSync(ep)) {
      skipIncomplete++
      continue
    }
    const summary: unknown = JSON.parse(await readFile(sp, 'utf-8'))
    if (!isSweepSummary(summary)) {
      skipPack++
      continue
    }
    const env = JSON.parse(await readFile(ep, 'utf-8')) as EnvSnapshot
    if (args.cleanOnly && env.git.dirty) {
      skipDirty++
      continue
    }
    runDirs++
    for (const result of summary.results) {
      sortable.push({
        ds: baseName(summary.dataset.path),
        composite: result.composite,
        row: toRow(result, summary.dataset, env),
      })
    }
  }
  // sortieren: datensatz aufsteigend , dann composite absteigend
  sortable.sort((a, b) => a.ds.localeCompare(b.ds) || b.composite - a.composite)
  const rows = sortable.map((s) => s.row)

  const csvPath = join(args.out, 'paper-table.csv')
  const texPath = join(args.out, 'paper-table.tex')
  await writeFile(csvPath, toCsv(rows), 'utf-8')
  await writeFile(texPath, toLatex(rows), 'utf-8')

  console.error(`paper-table: ${rows.length} zeilen aus ${runDirs} sweep-run(s)`)
  console.error(`  CSV: ${csvPath}`)
  console.error(`  TEX: ${texPath}`)
  if (skipPack || skipDirty || skipIncomplete) {
    console.error(
      `  übersprungen: pack=${skipPack} dirty=${skipDirty} unvollständig=${skipIncomplete}`,
    )
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
