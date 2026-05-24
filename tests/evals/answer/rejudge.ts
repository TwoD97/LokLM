// rejudge — füllt fehlende judge-scores in einer run-dir nach.
//
// Use-case: gemma-3-4b's 25 antworten haben judge=null bekommen weil
// in dem subprocess der judge-warm geklemmt hat (vermutlich VRAM-druck
// nach gemma-bridge-unload). Die LLM-antworten sind aber in per-question.jsonl
// gespeichert. Wir können den judge isoliert nochmal warm machen und alle
// records mit `judge == null && llm != null` nachscoren — ohne den
// pass-1 (retrieval + LLM-ask) zu wiederholen.
//
// CLI:
//   tsx tests/evals/answer/rejudge.ts --run-dir <path>
//                                     [--config <name>]   (default: alle configs)
//                                     [--judge-path <gguf>]
//                                     [--judge-context <n>]
//
// Idempotent: skipt records die bereits einen parsed judge haben.

import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { JudgeScore } from '../judge/Judge'
import type { QuestionIntent } from '../synth/QuestionGenerator'
import { compositeScore } from '../judge/Judge'

interface PerQuestionRecord {
  question: string
  expectedChunkId: string
  requiredChunkIds: string[]
  intent: QuestionIntent
  retrievedChunkIds: string[]
  rerankedChunkIds: string[]
  llm: { text: string } | null
  judge: JudgeScore | null
  // andere felder werden durchgereicht , nicht modifiziert
  [k: string]: unknown
}

interface ConfigResult {
  config: string
  recallAt5: number
  judgeAvg: {
    score: number
    correctness: number
    groundedness: number
    helpfulness: number
    parsedFraction: number
  } | null
  composite: number
  phased: { ttft: { p50: number } }
  [k: string]: unknown
}

interface Args {
  runDir: string
  configName?: string
  judgePath?: string
  judgeContext?: number
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--run-dir' && next !== undefined) {
      out.runDir = next
      i++
    } else if (a === '--config' && next !== undefined) {
      out.configName = next
      i++
    } else if (a === '--judge-path' && next !== undefined) {
      out.judgePath = next
      i++
    } else if (a === '--judge-context' && next !== undefined) {
      out.judgeContext = Number(next)
      i++
    }
  }
  if (!out.runDir) throw new Error('--run-dir <path> ist required')
  return out as Args
}

async function loadDataset(runDir: string): Promise<{ chunkTextById: Map<string, string> }> {
  // dataset.json zeigt auf den ursprünglichen pfad. der judge braucht
  // expectedChunkText + providedChunks-texte. Wir laden den dataset-file
  // direkt um die chunk-id → text mapping zu rekonstruieren.
  const dsInfo = JSON.parse(await readFile(join(runDir, 'dataset.json'), 'utf-8')) as {
    path: string
    library?: { path: string } | null
  }
  const dataset = JSON.parse(await readFile(dsInfo.path, 'utf-8')) as {
    chunks: { id: string; text: string }[]
  }
  const chunkTextById = new Map<string, string>()
  for (const c of dataset.chunks) chunkTextById.set(c.id, c.text)
  if (dsInfo.library?.path && existsSync(dsInfo.library.path)) {
    const lib = JSON.parse(await readFile(dsInfo.library.path, 'utf-8')) as {
      chunks: { id: string; text: string }[]
    }
    for (const c of lib.chunks) chunkTextById.set(c.id, c.text)
  }
  return { chunkTextById }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const runDir = resolve(args.runDir)
  const configsRoot = join(runDir, 'configs')
  if (!existsSync(configsRoot)) {
    throw new Error(`run-dir hat keine configs/: ${configsRoot}`)
  }

  const { chunkTextById } = await loadDataset(runDir)
  console.error(`[rejudge] dataset: ${chunkTextById.size} chunk-texte geladen`)

  // configs auflisten: optional auf einen namen einschränken (genau-match
  // ODER substring-match auf dem dir-namen).
  let configDirs = (await readdir(configsRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  if (args.configName) {
    const needle = args.configName
    const before = configDirs.length
    configDirs = configDirs.filter((d) => d === needle || d.includes(needle))
    console.error(`[rejudge] --config '${needle}': ${before} → ${configDirs.length}`)
  }
  if (configDirs.length === 0) {
    console.error('[rejudge] keine matchenden configs gefunden')
    process.exit(1)
  }

  // Configs scannen: welche haben null-judge-records ?
  interface Job {
    cfgDir: string
    records: PerQuestionRecord[]
    missingIndices: number[]
  }
  const jobs: Job[] = []
  for (const d of configDirs) {
    const perQPath = join(configsRoot, d, 'per-question.jsonl')
    if (!existsSync(perQPath)) continue
    const raw = await readFile(perQPath, 'utf-8')
    const records: PerQuestionRecord[] = raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as PerQuestionRecord)
    const missing: number[] = []
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!
      // re-judge wenn judge fehlt ODER judge unparsed UND llm-text vorhanden ist
      if (r.llm && (r.judge === null || (r.judge && !r.judge.parsed))) {
        missing.push(i)
      }
    }
    if (missing.length === 0) {
      console.error(`[rejudge] ${d}: alle ${records.length} schon gescored , skip`)
      continue
    }
    jobs.push({ cfgDir: d, records, missingIndices: missing })
    console.error(`[rejudge] ${d}: ${missing.length}/${records.length} brauchen rejudge`)
  }
  if (jobs.length === 0) {
    console.error('[rejudge] nichts zu tun , alle scores vorhanden')
    return
  }

  // Judge EINMAL laden , alle jobs sequenziell durchziehen.
  const { LocalLlmJudge } = await import('../judge/LocalLlmJudge')
  const judgeOpts: { modelPath?: string; profile?: 'xl'; contextSize: number } = {
    contextSize: args.judgeContext ?? 8192,
  }
  if (args.judgePath) judgeOpts.modelPath = resolve(args.judgePath)
  else if (!process.env.LOKLM_JUDGE_PATH) judgeOpts.profile = 'xl'
  const judge = new LocalLlmJudge(judgeOpts)
  console.error(`\n[rejudge] warming judge: ${judge.name} …`)
  await judge.warm?.()
  console.error(`[rejudge] judge ready: ${judge.name}`)

  for (const job of jobs) {
    console.error(`\n[rejudge] ${job.cfgDir} , ${job.missingIndices.length} records …`)
    let done = 0
    let failed = 0
    for (const idx of job.missingIndices) {
      const r = job.records[idx]!
      if (!r.llm) continue
      const expectedChunkTexts = (r.requiredChunkIds ?? [r.expectedChunkId])
        .map((id) => chunkTextById.get(id) ?? '')
        .filter((t) => t.length > 0)
      const providedChunks = (r.rerankedChunkIds ?? [])
        .map((id) => chunkTextById.get(id) ?? '')
        .filter((t) => t.length > 0)
      try {
        const score = await judge.score({
          question: r.question,
          intent: r.intent,
          expectedChunkText: chunkTextById.get(r.expectedChunkId) ?? '',
          expectedChunkTexts,
          providedChunks,
          generatedAnswer: r.llm.text,
        })
        r.judge = score
        done++
      } catch (err) {
        failed++
        console.error(`[rejudge]   #${idx + 1} failed: ${err instanceof Error ? err.message : err}`)
      }
      if ((done + failed) % 5 === 0) {
        console.error(`[rejudge]   progress ${done + failed}/${job.missingIndices.length}`)
      }
    }
    console.error(`[rejudge] ${job.cfgDir}: ${done} gescored , ${failed} failed`)

    // per-question.jsonl + result.json rewritten
    const perQPath = join(configsRoot, job.cfgDir, 'per-question.jsonl')
    await writeFile(perQPath, job.records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')

    // judgeAvg + composite neu berechnen
    const parsed = job.records
      .map((r) => r.judge)
      .filter((j): j is JudgeScore => j !== null && j.parsed)
    const totalScored = job.records.filter((r) => r.judge !== null).length
    const judgeAvg =
      parsed.length === 0
        ? null
        : {
            score: avg(parsed.map((j) => j.score)),
            correctness: avg(parsed.map((j) => j.correctness)),
            groundedness: avg(parsed.map((j) => j.groundedness)),
            helpfulness: avg(parsed.map((j) => j.helpfulness)),
            parsedFraction: totalScored > 0 ? parsed.length / totalScored : 0,
          }
    const resultPath = join(configsRoot, job.cfgDir, 'result.json')
    const result = JSON.parse(await readFile(resultPath, 'utf-8')) as ConfigResult
    result.judgeAvg = judgeAvg
    result.composite = compositeScore({
      judgeScore: judgeAvg?.score ?? null,
      recallAt5: result.recallAt5,
      ttftMs: result.phased.ttft.p50 > 0 ? result.phased.ttft.p50 : null,
    })
    await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8')
    console.error(
      `[rejudge] ${job.cfgDir}: judgeAvg=${judgeAvg?.score.toFixed(3) ?? '-'} composite=${result.composite.toFixed(3)}`,
    )
  }

  try {
    await (judge as unknown as { unload?: () => Promise<void> }).unload?.()
  } catch {
    /* ignore */
  }
  console.error('\n[rejudge] fertig. ranking.md / summary.md neu generieren via:')
  console.error('  pnpm evals:pack --pack <pack.json> --run-dir <run-dir>')
  console.error('  (orchestrator regeneriert die aggregate-views aus result.json files)')
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
