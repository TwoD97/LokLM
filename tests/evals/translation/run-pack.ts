// run-pack , orchestrator der translation-eval. Subprocess pro modell ,
// gleiche crash-isolation wie answer/run-pack.ts (node-llama-cpp leaked
// state über load/unload-zyklen — ein modell killt nicht den ganzen lauf).
//
// Workflow:
//   1. run-dir unter report/translation-runs/ anlegen (oder --run-dir resume) ,
//      env.json + dataset.json + pack.json (provenance) schreiben
//   2. pro modell run-translation.ts spawnen ; modelle mit existierendem
//      configs/<label>/result.json werden übersprungen (resume)
//   3. report.ts baut summary.md + summary.json (chrF-matrix + verdicts ;
//      COMET-spalten kommen dazu sobald comet/score_comet.py gelaufen ist —
//      danach einfach pnpm evals:translation:report nochmal)
//
// CLI:
//   tsx tests/evals/translation/run-pack.ts [--pack <pack.json>]
//     [--slice <path>] [--limit <n>] [--langs de,fr] [--placement auto|cpu]
//     [--run-dir <existing>]   (resume)

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunDir, envSnapshot, hashBytes, useRunDir } from '../runDir'
import { defaultSlicePath, type FloresSlice } from './download-flores'
import { buildReport } from './report'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface PackModel {
  label: string
  /** repo-relativ oder absolut. */
  path: string
  /** lite | standard | pro | baseline — steuert die verdict-zuordnung im report. */
  tier: string
  contextSize?: number
  placement?: string
}

export interface TranslationPack {
  name?: string
  models: PackModel[]
}

interface Args {
  pack: string
  slice: string
  limit: number | null
  langs: string | null
  placement: string | null
  runDir: string | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    pack: join(__dirname, 'translation-pack.json'),
    slice: defaultSlicePath(),
    limit: null,
    langs: null,
    placement: null,
    runDir: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--pack' && next !== undefined) {
      out.pack = resolve(next)
      i++
    } else if (a === '--slice' && next !== undefined) {
      out.slice = resolve(next)
      i++
    } else if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    } else if (a === '--langs' && next !== undefined) {
      out.langs = next
      i++
    } else if (a === '--placement' && next !== undefined) {
      out.placement = next
      i++
    } else if (a === '--run-dir' && next !== undefined) {
      out.runDir = resolve(next)
      i++
    }
  }
  return out
}

const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)

function runWorker(args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('pnpm', ['exec', 'tsx', ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', rejectP)
    child.on('exit', (code, signal) => {
      if (code === 0) resolveP()
      else rejectP(new Error(`worker exit code=${code} signal=${signal ?? '-'}`))
    })
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const pack = JSON.parse(await readFile(args.pack, 'utf-8')) as TranslationPack
  if (!Array.isArray(pack.models) || pack.models.length === 0) {
    throw new Error(`pack ${args.pack} hat keine .models`)
  }
  if (!existsSync(args.slice)) {
    throw new Error(`slice ${args.slice} fehlt — erst pnpm evals:translation:data laufen lassen`)
  }
  const sliceBytes = await readFile(args.slice)
  const slice = JSON.parse(sliceBytes.toString('utf-8')) as FloresSlice
  const numLangs = Object.keys(slice.languages).length

  // fehlende GGUFs VOR dem lauf melden , nicht nach 2h mitten drin.
  const missing = pack.models.filter((m) => !existsSync(resolve(m.path)))
  if (missing.length > 0) {
    console.error(`[orchestrator] ${missing.length} modell-file(s) fehlen:`)
    for (const m of missing) console.error(`  - ${m.label}: ${m.path}`)
    console.error(`[orchestrator] → pnpm models:translation (bzw. models:evals) , dann nochmal.`)
    process.exit(2)
  }

  let runRootDir: string
  if (args.runDir) {
    runRootDir = args.runDir
    await useRunDir(runRootDir)
    console.error(`[orchestrator] resume in ${runRootDir}`)
  } else {
    const handle = await createRunDir({
      runsRoot: join(__dirname, '..', 'report', 'translation-runs'),
    })
    runRootDir = handle.rootDir
    await handle.writeEnv(envSnapshot())
    // DatasetInfo-felder zweckentfremdet: numQuestions = satzpaare gesamt ,
    // numChunks = sprachen. Reicht für die provenance , das eigentliche
    // dataset-detail steht im slice selbst.
    await handle.writeDataset({
      path: args.slice,
      sha256: hashBytes(sliceBytes),
      generator: slice.source,
      generatedAt: slice.fetchedAt,
      numQuestions: numLangs * slice.sampleSize * 2,
      numChunks: numLangs,
      library: null,
    })
    console.error(`[orchestrator] new run-dir ${runRootDir}`)
  }
  // pack mit in den run-dir — der report braucht die tier-zuordnung.
  await writeFile(
    join(runRootDir, 'pack.json'),
    JSON.stringify({ ...pack, sourcePath: args.pack }, null, 2),
    'utf-8',
  )

  const failures: Array<{ label: string; reason: string }> = []
  const skipped: string[] = []

  for (let i = 0; i < pack.models.length; i++) {
    const m = pack.models[i]!
    const resultPath = join(runRootDir, 'configs', sanitize(m.label), 'result.json')
    if (existsSync(resultPath)) {
      console.error(
        `[orchestrator] [${i + 1}/${pack.models.length}] ${m.label} — bereits da , skip`,
      )
      skipped.push(m.label)
      continue
    }
    const workerArgs = [
      'tests/evals/translation/run-translation.ts',
      '--model',
      resolve(m.path),
      '--label',
      m.label,
      '--run-dir',
      runRootDir,
      '--slice',
      args.slice,
    ]
    if (m.contextSize !== undefined) workerArgs.push('--context', String(m.contextSize))
    const placement = args.placement ?? m.placement
    if (placement) workerArgs.push('--placement', placement)
    if (args.limit !== null) workerArgs.push('--limit', String(args.limit))
    if (args.langs) workerArgs.push('--langs', args.langs)

    console.error(`\n[orchestrator] [${i + 1}/${pack.models.length}] spawn worker für ${m.label} …`)
    try {
      await runWorker(workerArgs)
      console.error(`[orchestrator] ${m.label} fertig`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[orchestrator] ${m.label} FAILED: ${reason}`)
      failures.push({ label: m.label, reason })
    }
  }

  const { markdown, json } = await buildReport(runRootDir)
  const handle = await useRunDir(runRootDir)
  await handle.writeSummary(markdown, { ...(json as object), failures, skipped })

  console.error(`\n[orchestrator] summary: ${join(runRootDir, 'summary.md')}`)
  console.error(
    `[orchestrator] COMET nachziehen: python tests/evals/translation/comet/score_comet.py ` +
      `--run-dir "${runRootDir}" , danach pnpm evals:translation:report -- --run-dir "${runRootDir}"`,
  )
  if (failures.length > 0) {
    console.error(`[orchestrator] ${failures.length} modell(e) failed — siehe summary.md`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
