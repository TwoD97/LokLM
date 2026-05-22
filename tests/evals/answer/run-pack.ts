// run-pack , subprocess-per-model orchestrator für end-to-end RAG-evals.
//
// Warum nicht der in-process pack-modus von sweep.ts?
//   Erste in-process pack-runs sind nach modell 4-5 mit ACCESS_VIOLATION
//   (Windows 0xC0000005) gecrasht. node-llama-cpp leaked offenbar state über
//   load/unload-zyklen — CUDA-context , listener-registry oder ähnliches.
//   Saubere isolation per kindprozess kostet uns 10 × corpus-embed (~5 min/
//   model auf CPU) , ist aber crash-resistent: ein modell killt nicht den
//   gesamten 3h-lauf.
//
// Workflow:
//   1. parent legt EINEN run-dir an + schreibt env.json/dataset.json
//   2. pro modell aus pack: temp single-model-pack.json schreiben , dann
//      `tsx tests/evals/sweep.ts --configs answer --llm-models <temp>
//        --run-dir <shared> --skip-summary --judge --judge-path ...`
//      spawnen. Jeder kindprozess macht seinen eigenen pass-1 + judge-pass
//      und schreibt configs/answer@<label>/result.json + per-question.jsonl.
//   3. wenn ein modell crasht , wird der fehler geloggt aber die anderen
//      laufen weiter. Resume-fähig: ein modell mit existierendem
//      configs/answer-<label>/result.json wird übersprungen.
//   4. am ende: alle result.json einsammeln , kombinierte summary.md +
//      ranking.md schreiben.
//
// CLI:
//   tsx tests/evals/answer/run-pack.ts --pack <pack.json>
//                                      [--judge-path <gguf>] [--judge-context <n>]
//                                      [--dataset <path>] [--limit <n>]
//                                      [--run-dir <existing>]   (resume)

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRunDir,
  defaultRunsRoot,
  envSnapshot,
  gitInfo,
  hashBytes,
  runFolderName,
  timestamp,
  useRunDir,
  type DatasetInfo,
} from '../runDir'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface PackModel {
  label: string
  path: string
  contextSize?: number
  language?: 'de' | 'en'
  placement?: 'cpu' | 'gpu' | 'auto'
}

interface Pack {
  name?: string
  models: PackModel[]
}

interface OrchestratorArgs {
  pack: string
  judgePath?: string
  judgeContext?: number
  dataset?: string
  limit?: number
  /** resume in einen existierenden run-dir. Modelle deren configs/<name>/result.json
   *  schon da sind , werden übersprungen. */
  runDir?: string
}

function parseArgs(argv: string[]): OrchestratorArgs {
  const out: Partial<OrchestratorArgs> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--pack' && next !== undefined) {
      out.pack = next
      i++
    } else if (a === '--judge-path' && next !== undefined) {
      out.judgePath = next
      i++
    } else if (a === '--judge-context' && next !== undefined) {
      out.judgeContext = Number(next)
      i++
    } else if (a === '--dataset' && next !== undefined) {
      out.dataset = next
      i++
    } else if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    } else if (a === '--run-dir' && next !== undefined) {
      out.runDir = next
      i++
    }
  }
  if (!out.pack) throw new Error('--pack <pack.json> ist required')
  return out as OrchestratorArgs
}

async function latestDataset(): Promise<string> {
  const dir = join(__dirname, '..', 'data', 'datasets')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    throw new Error(`keine datasets unter ${dir} , erst pnpm evals:generate laufen lassen`)
  }
  files.sort()
  return join(dir, files[files.length - 1]!)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const packRaw = await readFile(args.pack, 'utf-8')
  const pack = JSON.parse(packRaw) as Pack
  if (!Array.isArray(pack.models) || pack.models.length === 0) {
    throw new Error(`pack ${args.pack} hat keine .models`)
  }

  const datasetPath = args.dataset ?? (await latestDataset())
  const datasetBytes = await readFile(datasetPath)
  const dataset = JSON.parse(datasetBytes.toString('utf-8')) as {
    generator: string
    generatedAt: string
    chunks: { id: string }[]
    questions: { question: string }[]
  }

  // run-dir: entweder vorgegeben (resume) oder neu erstellt.
  let runRootDir: string
  if (args.runDir) {
    runRootDir = resolve(args.runDir)
    await useRunDir(runRootDir) // mkdir -p configs/
    console.error(`[orchestrator] resume in ${runRootDir}`)
  } else {
    const handle = await createRunDir()
    runRootDir = handle.rootDir
    await handle.writeEnv(envSnapshot())
    const datasetInfo: DatasetInfo = {
      path: resolve(datasetPath),
      sha256: hashBytes(datasetBytes),
      generator: dataset.generator,
      generatedAt: dataset.generatedAt,
      numQuestions: dataset.questions.length,
      numChunks: dataset.chunks.length,
      library: null,
    }
    await handle.writeDataset(datasetInfo)
    console.error(`[orchestrator] new run-dir ${runRootDir}`)
  }

  // Sanitize muss zu sweep.ts/runDir.ts passen — der writer verwendet `answer@<label>`
  // als config-namen und sanitize() schreibt `answer-<label>` auf disk.
  const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)

  const tempDir = join(runRootDir, 'orchestrator-temp')
  await mkdir(tempDir, { recursive: true })

  const failures: Array<{ label: string; reason: string }> = []
  const skipped: string[] = []

  for (let i = 0; i < pack.models.length; i++) {
    const m = pack.models[i]!
    const expectedConfigDir = join(runRootDir, 'configs', sanitize(`answer@${m.label}`))
    const resultPath = join(expectedConfigDir, 'result.json')
    if (existsSync(resultPath)) {
      console.error(
        `[orchestrator] [${i + 1}/${pack.models.length}] ${m.label} — bereits da , skip`,
      )
      skipped.push(m.label)
      continue
    }

    // Single-model pack-datei für diesen subprocess.
    const tempPack = join(tempDir, `pack-${sanitize(m.label)}.json`)
    await writeFile(tempPack, JSON.stringify({ name: m.label, models: [m] }, null, 2), 'utf-8')

    const sweepArgs = [
      'tests/evals/sweep.ts',
      '--configs',
      'answer',
      '--llm-models',
      tempPack,
      '--run-dir',
      runRootDir,
      '--skip-summary',
      '--dataset',
      datasetPath,
      '--judge',
    ]
    if (args.judgePath) sweepArgs.push('--judge-path', args.judgePath)
    if (args.judgeContext !== undefined)
      sweepArgs.push('--judge-context', String(args.judgeContext))
    if (args.limit !== undefined) sweepArgs.push('--limit', String(args.limit))

    console.error(`\n[orchestrator] [${i + 1}/${pack.models.length}] spawn sweep für ${m.label} …`)
    try {
      await runSweep(sweepArgs)
      console.error(`[orchestrator] ${m.label} fertig`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[orchestrator] ${m.label} FAILED: ${reason}`)
      failures.push({ label: m.label, reason })
    }
  }

  // Aggregation: alle result.json unter configs/ einsammeln , combined
  // summary.md + ranking.md schreiben.
  const configsRoot = join(runRootDir, 'configs')
  const subdirs = (await readdir(configsRoot, { withFileTypes: true })).filter((d) =>
    d.isDirectory(),
  )
  type Result = {
    config: string
    judgeAvg: { score: number } | null
    recallAt5: number
    composite: number
    phased: {
      ttft: { p50: number }
      fullResponse: { p50: number }
    }
    llmEnabled: boolean
    numQueries: number
  }
  const results: Result[] = []
  for (const d of subdirs) {
    const p = join(configsRoot, d.name, 'result.json')
    if (!existsSync(p)) continue
    try {
      const r = JSON.parse(await readFile(p, 'utf-8')) as Result
      results.push(r)
    } catch {
      /* skip malformed */
    }
  }

  results.sort((a, b) => b.composite - a.composite)

  const headerLines = [
    `# Pack-Run Aggregat`,
    ``,
    `- Run-Dir: ${runRootDir}`,
    `- Pack: ${args.pack}${pack.name ? ` (${pack.name})` : ''}`,
    `- Dataset: ${datasetPath}`,
    `- Modelle im pack: ${pack.models.length} , erfolgreich: ${results.length} , skipped: ${skipped.length} , failed: ${failures.length}`,
    ``,
  ]
  if (failures.length > 0) {
    headerLines.push(`## Failures`)
    headerLines.push(``)
    for (const f of failures) headerLines.push(`- **${f.label}**: ${f.reason}`)
    headerLines.push(``)
  }
  const ranking = [
    `## Ranking (composite , höher = besser)`,
    ``,
    `| Rang | Modell | Composite | judge | recall@5 | TTFT p50 (ms) | FullResp p50 (ms) | n |`,
    `| -: | ------ | -: | -: | -: | -: | -: | -: |`,
    ...results.map(
      (r, i) =>
        `| ${i + 1} | ${r.config} | ${r.composite.toFixed(3)} | ${
          r.judgeAvg ? r.judgeAvg.score.toFixed(3) : '-'
        } | ${r.recallAt5.toFixed(3)} | ${r.llmEnabled ? r.phased.ttft.p50.toFixed(0) : '-'} | ${
          r.llmEnabled ? r.phased.fullResponse.p50.toFixed(0) : '-'
        } | ${r.numQueries} |`,
    ),
    ``,
  ]
  const summaryMd = [...headerLines, ...ranking].join('\n')
  await writeFile(join(runRootDir, 'summary.md'), summaryMd, 'utf-8')
  await writeFile(
    join(runRootDir, 'ranking.md'),
    [
      `# Ranking`,
      ``,
      `Pack-run: ${args.pack}. Composite = judge*2 + recall@5 − ttft_sec*0.5. Höher = besser.`,
      `Run-Dir: ${runRootDir}`,
      ``,
      ...ranking.slice(2),
    ].join('\n'),
    'utf-8',
  )
  await writeFile(
    join(runRootDir, 'summary.json'),
    JSON.stringify({ pack: args.pack, results, failures, skipped }, null, 2),
    'utf-8',
  )

  // Cleanup temp single-model packs.
  await rm(tempDir, { recursive: true, force: true })

  console.error(`\n[orchestrator] aggregate: ${join(runRootDir, 'summary.md')}`)
  console.error(`[orchestrator] ranking:   ${join(runRootDir, 'ranking.md')}`)
  if (failures.length > 0) {
    console.error(`[orchestrator] ${failures.length} modell(e) failed — siehe summary.md`)
    process.exit(1)
  }
}

/** Spawnt einen sweep.ts-kindprozess , erbt stdio , wartet auf exit.
 *  Wirft wenn exit-code != 0 (inkl. SEGV). */
function runSweep(args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    // tsx muss in PATH oder via npx aufgerufen werden. pnpm exec tsx ist
    // robust auf cross-shell weil pnpm das resolution macht.
    const child = spawn('pnpm', ['exec', 'tsx', ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', rejectP)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveP()
      } else {
        rejectP(new Error(`sweep exit code=${code} signal=${signal ?? '-'}`))
      }
    })
  })
}

// Suppresses unused warnings — these come from runDir but the orchestrator
// uses them transitively (createRunDir uses gitInfo + timestamp + runFolderName).
void defaultRunsRoot
void gitInfo
void timestamp
void runFolderName

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
