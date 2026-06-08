// run-datasets.ts — äußere schleife über MEHRERE datensätze. sweep/pack nehmen
// genau einen --dataset ; dies ist die fehlende datensatz-achse. Pro datensatz
// ein eigener , isolierter sweep-aufruf (eigenes run-dir) ; ein fehlgeschlagener
// datensatz stoppt die anderen NICHT (vorlage: answer/run-pack.ts , nur dass die
// äußere achse hier datensätze statt modelle sind).
//
// CLI:
//   tsx tests/evals/run-datasets.ts [--datasets a.json,b.json] [--limit <n>]
//                                   [--judge [--judge-path <gguf>]]
//
//   ohne --datasets : alle committeten datensätze unter tests/evals/data/datasets/
//   default ist retrieval-only (--no-llm) ; --judge schaltet den LLM+judge-pass an.
//
// danach: pnpm evals:paper aggregiert alle run-dirs zur paper-tabelle.

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface Args {
  datasets: string[]
  limit?: number
  judge: boolean
  judgePath?: string
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { datasets: [], judge: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--datasets' && next !== undefined) {
      out.datasets = next
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      i++
    } else if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    } else if (a === '--judge') {
      out.judge = true
    } else if (a === '--judge-path' && next !== undefined) {
      out.judgePath = next
      i++
    }
  }
  return out
}

/** baut die sweep.ts-argumente für EINEN datensatz. Die invariante: im
 *  judge-modus NIE --no-llm mitschicken (sweep wirft sonst — --judge braucht ein
 *  LLM) ; im default-modus immer --no-llm (schnell + deterministisch). */
export function buildSweepArgs(datasetPath: string, args: Args): string[] {
  const out = ['tests/evals/sweep.ts', '--configs', 'matrix', '--dataset', datasetPath]
  if (args.judge) {
    out.push('--judge')
    if (args.judgePath) out.push('--judge-path', args.judgePath)
  } else {
    out.push('--no-llm')
  }
  if (args.limit !== undefined) out.push('--limit', String(args.limit))
  return out
}

async function defaultDatasets(): Promise<string[]> {
  const dir = join(__dirname, 'data', 'datasets')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  files.sort()
  return files.map((f) => join(dir, f))
}

const base = (p: string): string => p.split(/[/\\]/).pop() ?? p

function runSweep(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    // pnpm exec tsx ist robust cross-shell ; shell:true nur auf win32 (vorlage
    // run-pack.ts). stdio:inherit reicht die sweep-ausgabe direkt durch.
    const child = spawn('pnpm', ['exec', 'tsx', ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', rej)
    child.on('exit', (code, signal) => {
      if (code === 0) res()
      else rej(new Error(`sweep exit code=${code} signal=${signal ?? '-'}`))
    })
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const datasets = args.datasets.length > 0 ? args.datasets : await defaultDatasets()
  if (datasets.length === 0) {
    console.error('keine datensätze gefunden — erst pnpm evals:generate laufen lassen')
    process.exit(1)
  }
  if (args.judge && !args.judgePath) {
    console.error(
      '[datasets] hinweis: --judge ohne --judge-path nutzt LOKLM_JUDGE_PATH / profile xl',
    )
  }
  console.error(
    `[datasets] ${datasets.length} datensätze , modus: ${args.judge ? 'judge' : 'retrieval-only (--no-llm)'}`,
  )

  const failures: Array<{ dataset: string; reason: string }> = []
  for (let i = 0; i < datasets.length; i++) {
    const ds = datasets[i]!
    console.error(`\n[datasets] [${i + 1}/${datasets.length}] ${base(ds)}`)
    try {
      await runSweep(buildSweepArgs(ds, args))
      console.error(`[datasets] ${base(ds)} fertig`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[datasets] ${base(ds)} FAILED: ${reason}`)
      failures.push({ dataset: ds, reason })
    }
  }

  console.error(`\n[datasets] ${datasets.length - failures.length}/${datasets.length} ok`)
  if (failures.length > 0) {
    console.error('[datasets] fehlgeschlagen:')
    for (const f of failures) console.error(`  - ${base(f.dataset)}: ${f.reason}`)
  }
  console.error(
    '\nHinweis: jetzt `pnpm evals:paper` laufen lassen — aggregiert alle run-dirs zur paper-tabelle.',
  )
  if (failures.length > 0) process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
