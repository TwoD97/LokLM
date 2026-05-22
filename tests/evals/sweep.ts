// sweep , CLI für fine-tuning-evals.
//
// Workflow:
//   1. dataset laden (+ optional library distractor-chunks)
//   2. run-directory aufmachen unter tests/evals/report/runs/<stamp>_<sha>/
//   3. pro config: bridges warmen , corpus embedden (mit cache wenn embedder+
//      chunker bereits einmal gelaufen sind) , pro question PhasedTimer +
//      optional LLM-ask , per-question.jsonl streamen
//   4. resource-sampler im hintergrund (rss/vram/cpu) , 250ms-interval
//   5. summary.md + summary.json zusammenbauen
//
// CLI:
//   tsx tests/evals/sweep.ts [--dataset <path>] [--library <path>]
//                            [--configs default|sweep] [--limit <n>]
//                            [--no-llm]
//                            [--llm-models <pack.json>]
//                            [--judge] [--judge-path <gguf>] [--judge-context <n>]
//
// ohne --dataset wird das jüngste file unter data/datasets/ genommen.
// --configs default → defaultConfigs() , --configs sweep → sweepConfigs().
// --limit caps wie viele questions pro config gelaufen werden (für quick smoke).
// --no-llm überschreibt alle config.llm auf null (skip TTFT-messung).
// --llm-models <pack.json> evaluiert jede config gegen jedes modell im pack ;
//   die llm-bridge in der config wird ignoriert , bridges werden zwischen
//   modellen unloaded um RAM/VRAM-druck zu vermeiden.
// --judge-path zwingt den judge auf ein konkretes GGUF (sonst LOKLM_JUDGE_PATH
//   oder profile='xl'). --judge-context overridet die default 8192.

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cosineSimilarity } from './pipeline/Embedder'
import {
  defaultConfigs,
  sweepConfigs,
  gridConfigs,
  adaptiveTopKConfigs,
  answerConfigs,
  type PipelineConfig,
} from './pipeline/configs'
import type { Judge, JudgeScore } from './judge/Judge'
import { compositeScore } from './judge/Judge'
import type { GeneratedQuestion, QuestionIntent, SourceChunk } from './synth/QuestionGenerator'
import { questionIntent, requiredChunkSet } from './synth/QuestionGenerator'
import { recallAtK, recallRequiredAtK, mrr, ndcgAtK, type RankedResult } from './metrics'
import {
  PhasedTimer,
  ResourceSampler,
  summarizePhases,
  type PhasedSnapshot,
  type LatencySummary,
  type PhasedSummary,
  type ResourceSample,
} from './perf'
import { createRunDir, envSnapshot, hashBytes, useRunDir, type DatasetInfo } from './runDir'
import { evalChunksToHits } from './bridges/hits'
import type { LlmRunResult } from './bridges/LlmBridge'
import type { Placement } from './bridges/common'

interface ModelPackEntry {
  /** kurzer label für report-namen. wird an config-namen angehängt: `<cfg>@<label>`. */
  label: string
  /** absoluter oder repo-relativer pfad zum GGUF. */
  path: string
  /** ctx-window cap , default 8192. relevant für phi-4-14b (nur 16k!). */
  contextSize?: number
  language?: 'de' | 'en'
  placement?: Placement
}

interface ModelPack {
  /** schöner identifier für summary.md , optional. */
  name?: string
  models: ModelPackEntry[]
}

const __dirname = dirname(fileURLToPath(import.meta.url))

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

interface PerQuestionRecord {
  question: string
  expectedChunkId: string
  /** Multi-Relevant-Ground-Truth (Backward-compat: für single-relevant-Datensätze
   *  enthält dies [expectedChunkId]). */
  requiredChunkIds: string[]
  /** Intent-Tag aus dem Datensatz , 'focused' für alte Datensätze ohne Tag. */
  intent: QuestionIntent
  retrievedChunkIds: string[]
  rerankedChunkIds: string[]
  phases: PhasedSnapshot['phases']
  ttftMs: number
  fullResponseMs: number | null
  hit: boolean
  rank: number | null
  llm: LlmRunResult | null
  judge: JudgeScore | null
}

interface ConfigResult {
  config: string
  numQueries: number
  recallAt1: number
  recallAt5: number
  recallAt10: number
  /** Multi-Relevant-Recall — mittlere Abdeckung der required-Sets in Top-K.
   *  Identisch zu recall@K wenn alle Queries single-relevant sind. Wichtig
   *  für broad/summary-Datensätze , wo recall@K alleine nicht aussagekräftig
   *  ist , weil dort mehrere Chunks gleichzeitig erwartet werden. */
  recallRequiredAt5: number
  recallRequiredAt10: number
  recallRequiredAt12: number
  mrr: number
  ndcgAt10: number
  phased: PhasedSummary
  resourcePeak: {
    rssMiBMax: number
    rssMiBMean: number
    cpuLoadMean: number
    freeVramGBMin: number | null
  }
  buildMs: number
  llmEnabled: boolean
  /** mittelwert der judge-scores , null wenn judge disabled oder kein parsbares output */
  judgeAvg: {
    score: number
    correctness: number
    groundedness: number
    helpfulness: number
    parsedFraction: number
  } | null
  /** composite-score für ranking. höher = besser. siehe judge/Judge.ts. */
  composite: number
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const datasetPath = args.dataset ?? (await latestDataset())
  const datasetBytes = await readFile(datasetPath)
  const dataset = JSON.parse(datasetBytes.toString('utf-8')) as Dataset
  console.error(`dataset: ${datasetPath}`)
  console.error(`chunks: ${dataset.chunks.length} , fragen: ${dataset.questions.length}`)

  let library: Library | null = null
  let libraryBytes: Buffer | null = null
  let corpus: SourceChunk[] = dataset.chunks
  if (args.library) {
    libraryBytes = await readFile(args.library)
    library = JSON.parse(libraryBytes.toString('utf-8')) as Library
    corpus = [...dataset.chunks, ...library.chunks]
    console.error(`library: ${args.library} (${library.size} , ${library.chunks.length} chunks)`)
    console.error(`korpus gesamt: ${corpus.length} chunks`)
  }

  let configs: PipelineConfig[] =
    args.configs === 'default'
      ? defaultConfigs()
      : args.configs === 'grid'
        ? await gridConfigs()
        : args.configs === 'adaptive'
          ? await adaptiveTopKConfigs()
          : args.configs === 'answer'
            ? await answerConfigs()
            : await sweepConfigs()
  if (args.only && args.only.length > 0) {
    const patterns = args.only
    const before = configs.length
    configs = configs.filter((c) => patterns.some((p) => c.name.includes(p)))
    console.error(`--only ${patterns.join(',')} : ${before} → ${configs.length} configs`)
    if (configs.length === 0) {
      throw new Error(
        `--only filter matchte nichts. Verfügbare namen: siehe gridConfigs() / sweepConfigs()`,
      )
    }
  }
  if (args.iterations !== undefined && args.iterations > 0) {
    configs = configs.slice(0, args.iterations)
  }
  if (args.noLlm) configs = configs.map((c) => ({ ...c, llm: null }))
  // Pack-modus: ignoriert die llm-instanz die configs.ts vergibt und ersetzt
  // sie pro pack-eintrag im äußeren modell-loop. Hier auf null setzen verhindert
  // dass die factory-bridge versehentlich (un)geladen wird.
  let pack: ModelPack | null = null
  if (args.llmModels) {
    const packRaw = await readFile(args.llmModels, 'utf-8')
    pack = JSON.parse(packRaw) as ModelPack
    if (!Array.isArray(pack.models) || pack.models.length === 0) {
      throw new Error(`pack ${args.llmModels} hat keine .models entries`)
    }
    console.error(`pack: ${args.llmModels} (${pack.models.length} modelle)`)
    configs = configs.map((c) => ({ ...c, llm: null }))
  }
  if (configs.length === 0) throw new Error('keine configs ausgewählt')
  const llmActive = pack !== null || configs.some((c) => c.llm)
  console.error(`configs: ${configs.length} , LLM: ${llmActive ? 'an' : 'aus'}`)

  const questions =
    args.limit !== undefined ? dataset.questions.slice(0, args.limit) : dataset.questions

  // Judge wird NICHT mehr vor dem konfig-loop geladen. Two-pass-design: erst
  // alle LLM-asks unter dem under-test-LLM durchziehen , dann sämtliche
  // bridges unloaden , dann judge laden , dann judge-pass über die in-memory
  // PerQuestionRecord-arrays. Vorteil: unter-test-LLM (5 GB) und judge-LLM
  // (18 GB Mistral-Small/Nemotron) sind nie gleichzeitig resident — auf 32 GB
  // RAM machine bleibt das system responsive. Sanity-check früh: --judge
  // braucht configs mit LLM , sonst gibt's nichts zu beurteilen.
  if (args.judge && !llmActive) {
    throw new Error(
      `--judge braucht configs mit LLM ; --no-llm oder --configs default schließt das aus`,
    )
  }

  // --run-dir reuse: orchestrator (run-pack.ts) erstellt EINEN run-dir und
  // gibt ihn an mehrere sweep-kindprozesse weiter , damit alle configs unter
  // einem dach landen. Wenn nicht gesetzt , wie bisher neuen dir aufmachen.
  const runDir = args.runDir ? await useRunDir(args.runDir) : await createRunDir()
  await runDir.writeEnv(envSnapshot())
  const datasetInfo: DatasetInfo = {
    path: resolve(datasetPath),
    sha256: hashBytes(datasetBytes),
    generator: dataset.generator,
    generatedAt: dataset.generatedAt,
    numQuestions: dataset.questions.length,
    numChunks: dataset.chunks.length,
    library:
      library && libraryBytes && args.library
        ? {
            path: resolve(args.library),
            size: library.size,
            numChunks: library.chunks.length,
            sha256: hashBytes(libraryBytes),
          }
        : null,
  }
  await runDir.writeDataset(datasetInfo)
  console.error(`run-dir: ${runDir.rootDir}`)

  const results: ConfigResult[] = []
  // (cfg-name, writer, records) pro config , für den optionalen judge-pass.
  // Records halten wir in-memory damit pass-2 sie ohne re-read aktualisieren
  // kann; per-question.jsonl wird beim judge-rewrite überschrieben.
  const perConfigRecords: Array<{
    cfg: PipelineConfig
    writer: ReturnType<Awaited<ReturnType<typeof createRunDir>>['configWriter']>
    records: PerQuestionRecord[]
  }> = []
  // Cache embeddings per (embedder instance × chunker.name × corpus.length).
  // Reused across configs that share the same embedder reference — saves a
  // full re-embed of the corpus per config which is the slowest single step.
  const corpusVecCache = new Map<string, number[][]>()
  // chunk-text lookup für den judge-pass , gold-chunk-text per question.id.
  const chunkTextById = new Map(corpus.map((c) => [c.id, c.text] as const))

  // Outer loop = modelle (pack-modus) oder ein einziger durchlauf (legacy).
  // Innerer loop = configs. Im pack-modus wird die llm-bridge pro modell
  // gebaut , an alle configs durchgereicht und am modell-grenze unloaded.
  // Damit liegt nie mehr als ein under-test-modell gleichzeitig im speicher.
  interface ModelGroup {
    label: string | null
    configs: PipelineConfig[]
    bridgeToUnload: unknown
  }
  const modelGroups: ModelGroup[] = []
  if (pack) {
    const { LlmBridge } = await import('./bridges/LlmBridge')
    for (const m of pack.models) {
      const resolvedPath = resolve(m.path)
      if (!existsSync(resolvedPath)) {
        console.error(`pack: SKIP ${m.label} — fehlt ${resolvedPath}`)
        continue
      }
      const bridge = new LlmBridge({
        modelPath: resolvedPath,
        contextSize: m.contextSize ?? 8192,
        ...(m.placement ? { placement: m.placement } : {}),
        language: m.language ?? 'de',
        label: m.label,
      })
      const groupConfigs = configs.map((c) => ({
        ...c,
        llm: bridge,
        name: `${c.name}@${m.label}`,
      }))
      modelGroups.push({ label: m.label, configs: groupConfigs, bridgeToUnload: bridge })
    }
    if (modelGroups.length === 0) {
      throw new Error(`pack: kein einziges modell aus ${args.llmModels} lokal vorhanden`)
    }
  } else {
    modelGroups.push({ label: null, configs, bridgeToUnload: null })
  }

  let gi = 0
  for (const group of modelGroups) {
    gi++
    if (group.label) {
      console.error(`\n========== [modell ${gi}/${modelGroups.length}] ${group.label} ==========`)
    }
    for (let i = 0; i < group.configs.length; i++) {
      const cfg = group.configs[i]!
      console.error(`\n[${i + 1}/${group.configs.length}] config: ${cfg.name}`)
      const writer = runDir.configWriter(cfg.name)
      const { result, records } = await runConfig(cfg, {
        corpus,
        questions,
        writer,
        corpusVecCache,
      })
      results.push(result)
      perConfigRecords.push({ cfg, writer, records })
      console.error(formatResult(result))
    }
    // modell-grenze: die EINE bridge des groups unloaden (configs teilen sie).
    if (group.bridgeToUnload) {
      console.error(`\nunloading ${group.label} bridge before next modell …`)
      await tryUnload(group.bridgeToUnload)
    }
  }

  // Pass-1 ist durch — embedder/reranker können auch raus. Im pack-modus
  // wurden die LLM-bridges schon an der modell-grenze unloaded ; im legacy-
  // modus passiert das hier.
  console.error('\nunloading under-test bridges …')
  for (const cfg of configs) {
    await tryUnload(cfg.embedder)
    await tryUnload(cfg.reranker)
    if (!pack && cfg.llm) await tryUnload(cfg.llm)
  }

  // Pass-2: judge wird jetzt geladen und scored sequenziell alle gesammelten
  // records. Ergebnisse werden in-memory aktualisiert , dann per-question.jsonl
  // + result.json pro config rewritten.
  if (args.judge) {
    const { LocalLlmJudge } = await import('./judge/LocalLlmJudge')
    // Priorität: --judge-path > LOKLM_JUDGE_PATH env (innerhalb LocalLlmJudge)
    // > profile='xl' legacy. So kann der pack-run ohne env-mucking auf einen
    // kleinen judge (Mistral-Small-3.2-24B) zeigen.
    const judgeOpts: { modelPath?: string; profile?: 'xl'; contextSize: number } = {
      contextSize: args.judgeContext ?? 8192,
    }
    if (args.judgePath) judgeOpts.modelPath = resolve(args.judgePath)
    else if (!process.env.LOKLM_JUDGE_PATH) judgeOpts.profile = 'xl'
    const judge = new LocalLlmJudge(judgeOpts)
    console.error(`\nwarming judge: ${judge.name} (dauert ~10-60s) …`)
    await judge.warm?.()
    console.error(`judge ready: ${judge.name}`)
    for (let ci = 0; ci < perConfigRecords.length; ci++) {
      const entry = perConfigRecords[ci]!
      console.error(`\n[judge ${ci + 1}/${perConfigRecords.length}] ${entry.cfg.name}`)
      await scoreConfig(judge, entry, chunkTextById, results[ci]!)
    }
    await tryUnload(judge)
  }

  if (args.skipSummary) {
    // orchestrator schreibt am ende eine aggregate-summary über alle kinder.
    // Der einzelne kindprozess soll die summary.md nicht überschreiben.
    console.error(`\nresults (skip-summary): ${runDir.rootDir}/configs/`)
  } else {
    await runDir.writeSummary(formatMarkdown(results, datasetInfo, runDir.rootDir), {
      results,
      dataset: datasetInfo,
    })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      join(runDir.rootDir, 'ranking.md'),
      formatRanking(results, runDir.rootDir),
      'utf-8',
    )
    console.error(`\nreport: ${join(runDir.rootDir, 'summary.md')}`)
    console.error(`ranking: ${join(runDir.rootDir, 'ranking.md')}`)
  }
}

interface RunConfigInputs {
  corpus: SourceChunk[]
  questions: GeneratedQuestion[]
  writer: ReturnType<Awaited<ReturnType<typeof createRunDir>>['configWriter']>
  corpusVecCache: Map<string, number[][]>
}

interface RunConfigOutput {
  result: ConfigResult
  records: PerQuestionRecord[]
}

async function runConfig(cfg: PipelineConfig, inputs: RunConfigInputs): Promise<RunConfigOutput> {
  const { corpus, questions, writer, corpusVecCache } = inputs
  const topKToRerank = cfg.topKToRerank ?? 20
  const topKToLLM = cfg.topKToLLM ?? 5

  // warm bridges where applicable. fake impls have no warm(); we feature-check.
  await tryWarm(cfg.embedder)
  await tryWarm(cfg.reranker)
  if (cfg.llm) await tryWarm(cfg.llm)

  // hook ResourceSampler. vramProbe comes from the LLM bridge if loaded —
  // otherwise null and the freeVramGB column stays null (which the writer
  // treats as "no probe available" rather than zero).
  const vramProbe = cfg.llm?.vramProbe() ?? undefined
  const sampler = new ResourceSampler({ intervalMs: 250, ...(vramProbe ? { vramProbe } : {}) })
  sampler.start()

  // build: embed the corpus once (or reuse cached vectors).
  const cacheKey = `${cfg.embedder.name}::${cfg.chunker.name}::${corpus.length}`
  const buildStart = performance.now()
  let chunkVecs = corpusVecCache.get(cacheKey)
  if (!chunkVecs) {
    chunkVecs = await cfg.embedder.embedBatch(corpus.map((c) => c.text))
    corpusVecCache.set(cacheKey, chunkVecs)
  }
  const buildMs = performance.now() - buildStart

  // per-question loop. Judge läuft NICHT inline — der judge-pass nach dem
  // configs-loop reichert die hier gespeicherten records nachträglich an.
  const snapshots: PhasedSnapshot[] = []
  const ranked: RankedResult[] = []
  const collectedRecords: PerQuestionRecord[] = []
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]!
    const timer = new PhasedTimer()

    const qVec = await timer.measure('queryEmbed', () => cfg.embedder.embed(q.question))

    const scored = await timer.measure('retrieve', async () =>
      corpus
        .map((c, i) => ({
          id: c.id,
          docId: c.docId,
          text: c.text,
          initialScore: cosineSimilarity(qVec, chunkVecs![i]!),
        }))
        .sort((a, b) => b.initialScore - a.initialScore)
        .slice(0, Math.max(topKToRerank, topKToLLM)),
    )

    // rerank , only over the topKToRerank slice. when topKToRerank is 0 we
    // skip the rerank phase entirely (timer stays at 0ms) and use initial
    // order for the LLM input.
    let rerankedChunks: typeof scored
    if (topKToRerank === 0) {
      rerankedChunks = scored.slice(0, topKToLLM)
    } else {
      const candidates = scored.slice(0, topKToRerank)
      const reranked = await timer.measure('rerank', () =>
        cfg.reranker.rerank(
          q.question,
          candidates.map((c) => ({ text: c.text, initialScore: c.initialScore })),
        ),
      )
      rerankedChunks = reranked
        .map((r) => candidates[r.initialIndex])
        .filter((c): c is (typeof scored)[number] => c !== undefined)
        .slice(0, topKToLLM)
    }

    // prompt assemble + LLM ask. when no LLM is wired the timer stays at 0
    // for prefill/firstDecode/fullResponse and the row reports retrieval-only.
    let llmResult: LlmRunResult | null = null
    if (cfg.llm) {
      const hits = await timer.measure('promptAssemble', async () =>
        evalChunksToHits(
          rerankedChunks.map((c) => ({
            id: c.id,
            docId: c.docId,
            text: c.text,
            score: c.initialScore,
          })),
        ),
      )
      llmResult = await cfg.llm.ask(q.question, hits)
      // prefill carries the full promptToFirstToken time. We can't split
      // prefill vs first-decode from the node-llama-cpp public surface, so
      // firstDecode stays at 0 — see LlmBridge.ts for the rationale.
      timer.set('prefill', llmResult.promptToFirstTokenMs)
      timer.set('fullResponse', llmResult.fullResponseMs)
    }

    const snapshot = timer.snapshot()
    snapshots.push(snapshot)

    const retrievedChunkIds = scored.slice(0, topKToLLM).map((s) => s.id)
    const rerankedChunkIds = rerankedChunks.map((c) => c.id)
    const expectedIdx = rerankedChunkIds.indexOf(q.chunkId)
    const required = requiredChunkSet(q)
    const intent = questionIntent(q)
    const record: PerQuestionRecord = {
      question: q.question,
      expectedChunkId: q.chunkId,
      requiredChunkIds: required,
      intent,
      retrievedChunkIds,
      rerankedChunkIds,
      phases: snapshot.phases,
      ttftMs: snapshot.ttftMs,
      fullResponseMs: snapshot.fullResponseMs,
      hit: expectedIdx !== -1,
      rank: expectedIdx === -1 ? null : expectedIdx + 1,
      llm: llmResult,
      judge: null,
    }
    ranked.push({ chunkIds: rerankedChunkIds, expected: q.chunkId, required })
    collectedRecords.push(record)
    await writer.appendPerQuestion(record)
  }

  const samples = sampler.stop()
  await writer.writeResourceSamples(samples)

  const phased = summarizePhases(snapshots)
  const resourcePeak = summarizeSamples(samples)
  // Pass-1: kein judge → judgeAvg=null , composite fällt auf recall-TTFT zurück.
  // Der judge-pass nachher rechnet judgeAvg + composite neu und überschreibt
  // result.json.
  const composite = compositeScore({
    judgeScore: null,
    recallAt5: recallAtK(ranked, 5),
    ttftMs: phased.ttft.p50 > 0 ? phased.ttft.p50 : null,
  })
  const result: ConfigResult = {
    config: cfg.name,
    numQueries: ranked.length,
    recallAt1: recallAtK(ranked, 1),
    recallAt5: recallAtK(ranked, 5),
    recallAt10: recallAtK(ranked, 10),
    recallRequiredAt5: recallRequiredAtK(ranked, 5),
    recallRequiredAt10: recallRequiredAtK(ranked, 10),
    recallRequiredAt12: recallRequiredAtK(ranked, 12),
    mrr: mrr(ranked),
    ndcgAt10: ndcgAtK(ranked, 10),
    phased,
    resourcePeak,
    buildMs,
    llmEnabled: cfg.llm !== null && cfg.llm !== undefined,
    judgeAvg: null,
    composite,
  }
  await writer.writeResult(result)
  return { result, records: collectedRecords }
}

/**
 * Judge-pass für eine config. Iteriert alle records , scored jede generierte
 * antwort gegen den gold-chunk + provided-chunks-context , aktualisiert
 * records.judge in-place. Schreibt am ende per-question.jsonl (vollständig
 * neu) und result.json (mit judgeAvg + neuem composite).
 *
 * Progress-log alle 5 fragen damit man sieht dass etwas passiert — XL-judge
 * auf CPU/GPU dauert pro call mehrere sekunden.
 */
async function scoreConfig(
  judge: Judge,
  entry: {
    cfg: PipelineConfig
    writer: ReturnType<Awaited<ReturnType<typeof createRunDir>>['configWriter']>
    records: PerQuestionRecord[]
  },
  chunkTextById: Map<string, string>,
  result: ConfigResult,
): Promise<void> {
  const { records, writer } = entry
  // rerankedChunkIds → für judge brauchen wir den provided-chunks-text.
  // Records speichern nur ids , also lookup über die corpus-map.
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!
    if (!r.llm) continue
    if (i % 5 === 0) {
      console.error(`  judging ${i + 1}/${records.length} …`)
    }
    try {
      const expectedChunkTexts = r.requiredChunkIds
        .map((id) => chunkTextById.get(id) ?? '')
        .filter((t) => t.length > 0)
      const score = await judge.score({
        question: r.question,
        intent: r.intent,
        expectedChunkText: chunkTextById.get(r.expectedChunkId) ?? '',
        expectedChunkTexts,
        providedChunks: r.rerankedChunkIds
          .map((id) => chunkTextById.get(id) ?? '')
          .filter((t) => t.length > 0),
        generatedAnswer: r.llm.text,
      })
      r.judge = score
    } catch (err) {
      console.error(`  judge failed on q#${i + 1}: ${err instanceof Error ? err.message : err}`)
    }
  }
  // Aggregate + composite mit judge re-berechnen.
  const parsed = records.map((r) => r.judge).filter((j): j is JudgeScore => j !== null && j.parsed)
  const totalScored = records.filter((r) => r.judge !== null).length
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
  result.judgeAvg = judgeAvg
  result.composite = compositeScore({
    judgeScore: judgeAvg?.score ?? null,
    recallAt5: result.recallAt5,
    ttftMs: result.phased.ttft.p50 > 0 ? result.phased.ttft.p50 : null,
  })
  await writer.writePerQuestionAll(records)
  await writer.writeResult(result)
  console.error(
    `  judge: avg=${judgeAvg?.score.toFixed(3) ?? '-'} composite=${result.composite.toFixed(3)}`,
  )
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function summarizeSamples(samples: ResourceSample[]): ConfigResult['resourcePeak'] {
  if (samples.length === 0) {
    return { rssMiBMax: 0, rssMiBMean: 0, cpuLoadMean: 0, freeVramGBMin: null }
  }
  let rssMax = 0
  let rssSum = 0
  let cpuSum = 0
  let vramMin: number | null = null
  for (const s of samples) {
    if (s.rssMiB > rssMax) rssMax = s.rssMiB
    rssSum += s.rssMiB
    cpuSum += s.cpuLoad
    if (s.freeVramGB !== null) {
      if (vramMin === null || s.freeVramGB < vramMin) vramMin = s.freeVramGB
    }
  }
  return {
    rssMiBMax: rssMax,
    rssMiBMean: Math.round(rssSum / samples.length),
    cpuLoadMean: Math.round((cpuSum / samples.length) * 1000) / 1000,
    freeVramGBMin: vramMin,
  }
}

function formatResult(r: ConfigResult): string {
  const tx = (s: LatencySummary): string => `${s.p50.toFixed(0)}/${s.p95.toFixed(0)}`
  const lines = [
    `  n=${r.numQueries} , build=${r.buildMs.toFixed(0)}ms`,
    `  recall@5=${r.recallAt5.toFixed(3)} , recall_req@5=${r.recallRequiredAt5.toFixed(3)} , ` +
      `recall_req@12=${r.recallRequiredAt12.toFixed(3)} , MRR=${r.mrr.toFixed(3)}`,
    r.llmEnabled
      ? `  TTFT p50/p95 = ${tx(r.phased.ttft)} ms , fullResp = ${tx(r.phased.fullResponse)} ms`
      : `  retrieval-only , query p50/p95 = ${tx(r.phased.perPhase.retrieve)} ms`,
    `  phases (mean ms): qEmb=${r.phased.perPhase.queryEmbed.mean.toFixed(1)} , ` +
      `retr=${r.phased.perPhase.retrieve.mean.toFixed(1)} , ` +
      `rerank=${r.phased.perPhase.rerank.mean.toFixed(1)} , ` +
      `prefill=${r.phased.perPhase.prefill.mean.toFixed(0)}`,
    `  res: rss-max=${r.resourcePeak.rssMiBMax} MiB , cpu=${(r.resourcePeak.cpuLoadMean * 100).toFixed(0)}% , ` +
      `vram-min=${r.resourcePeak.freeVramGBMin?.toFixed(1) ?? '-'} GB`,
  ]
  if (r.judgeAvg) {
    lines.push(
      `  judge: score=${r.judgeAvg.score.toFixed(2)} (corr=${r.judgeAvg.correctness.toFixed(2)} , ` +
        `ground=${r.judgeAvg.groundedness.toFixed(2)} , help=${r.judgeAvg.helpfulness.toFixed(2)} , ` +
        `parsed=${(r.judgeAvg.parsedFraction * 100).toFixed(0)}%)`,
    )
  }
  lines.push(`  composite = ${r.composite.toFixed(3)}`)
  return lines.join('\n')
}

function formatMarkdown(results: ConfigResult[], dataset: DatasetInfo, rootDir: string): string {
  const env = envSnapshot()
  const header = [
    `# Sweep-Report`,
    ``,
    `- Run-Dir: ${rootDir}`,
    `- Git: ${env.git.shortSha} (${env.git.branch})${env.git.dirty ? ' **dirty**' : ''}`,
    `- Hardware: ${env.hardware.cpuModel} × ${env.hardware.cpuCount} , ${env.hardware.totalRamGB} GB RAM`,
    `- Dataset: ${dataset.path}`,
    `- Dataset-hash: ${dataset.sha256} , ${dataset.numQuestions} Fragen , ${dataset.numChunks} Chunks`,
    dataset.library
      ? `- Library: ${dataset.library.size} (${dataset.library.numChunks} chunks , hash ${dataset.library.sha256})`
      : `- Library: keine`,
    ``,
    `## Quality + TTFT`,
    ``,
    `| Config | n | r@5 | r@10 | r_req@5 | r_req@12 | MRR | judge | TTFT p50 | TTFT p95 | FullResp p50 | qEmb | retr | rerank | prefill | rss-max MiB | cpu% | free VRAM min GB | composite |`,
    `| ------ | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: |`,
  ]
  const fmt = (n: number, d = 1): string => n.toFixed(d)
  const rows = results.map((r) =>
    [
      r.config,
      r.numQueries,
      fmt(r.recallAt5, 3),
      fmt(r.recallAt10, 3),
      fmt(r.recallRequiredAt5, 3),
      fmt(r.recallRequiredAt12, 3),
      fmt(r.mrr, 3),
      r.judgeAvg ? fmt(r.judgeAvg.score, 3) : '-',
      r.llmEnabled ? fmt(r.phased.ttft.p50, 0) : '-',
      r.llmEnabled ? fmt(r.phased.ttft.p95, 0) : '-',
      r.llmEnabled ? fmt(r.phased.fullResponse.p50, 0) : '-',
      fmt(r.phased.perPhase.queryEmbed.mean, 1),
      fmt(r.phased.perPhase.retrieve.mean, 1),
      fmt(r.phased.perPhase.rerank.mean, 1),
      fmt(r.phased.perPhase.prefill.mean, 0),
      r.resourcePeak.rssMiBMax,
      Math.round(r.resourcePeak.cpuLoadMean * 100),
      r.resourcePeak.freeVramGBMin?.toFixed(1) ?? '-',
      fmt(r.composite, 3),
    ]
      .map(String)
      .join(' | ')
      .replace(/^/, '| ')
      .replace(/$/, ' |'),
  )
  return [...header, ...rows, ''].join('\n')
}

/**
 * Ranking-tabelle: configs sortiert nach composite-score (höher = besser).
 * Schmaler als summary.md , für den schnellen blick "welche config ist die beste".
 */
function formatRanking(results: ConfigResult[], rootDir: string): string {
  const sorted = [...results].sort((a, b) => b.composite - a.composite)
  const lines = [
    `# Ranking`,
    ``,
    `Sortiert nach composite-score (judge*2 + recall@5 - ttft_sec*0.5).`,
    `Höher = besser. Volle daten in summary.md / configs/<name>/result.json.`,
    `Run-Dir: ${rootDir}`,
    ``,
    `| Rang | Config | Composite | recall@5 | judge | TTFT p50 (ms) | FullResp p50 (ms) |`,
    `| -: | ------ | -: | -: | -: | -: | -: |`,
  ]
  sorted.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.config} | ${r.composite.toFixed(3)} | ${r.recallAt5.toFixed(3)} | ` +
        `${r.judgeAvg ? r.judgeAvg.score.toFixed(3) : '-'} | ` +
        `${r.llmEnabled ? r.phased.ttft.p50.toFixed(0) : '-'} | ` +
        `${r.llmEnabled ? r.phased.fullResponse.p50.toFixed(0) : '-'} |`,
    )
  })
  lines.push('')
  return lines.join('\n')
}

async function latestDataset(): Promise<string> {
  const dir = join(__dirname, 'data', 'datasets')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  if (files.length === 0)
    throw new Error(`keine datasets unter ${dir} , erst pnpm evals:generate laufen lassen`)
  files.sort()
  return join(dir, files[files.length - 1]!)
}

interface SweepArgs {
  dataset?: string
  library?: string
  configs: 'default' | 'sweep' | 'grid' | 'adaptive' | 'answer'
  /** für grid: wie viele grid-punkte aus dem cartesian-raum gelaufen werden. */
  iterations?: number
  /** für `--limit N`: cappt wie viele questions pro config. */
  limit?: number
  noLlm: boolean
  /** wenn true , wird LocalLlmJudge gewärmt und pro generierter antwort gescored. */
  judge: boolean
  /** explizites GGUF für judge. Wins über LOKLM_JUDGE_PATH env. */
  judgePath?: string
  /** ctx-window cap für judge , default 8192. */
  judgeContext?: number
  /** pfad zur model-pack.json. Aktiviert pack-modus: jede config × jedes
   *  modell , bridges zwischen modellen unloaded. */
  llmModels?: string
  /** wenn gesetzt , schreibt sweep in diesen rundir statt einen neuen anzulegen.
   *  vom run-pack.ts-orchestrator genutzt um mehrere kindprozesse in einen
   *  gemeinsamen rundir zu schreiben. */
  runDir?: string
  /** unterdrueckt summary.md / ranking.md write am ende. orchestrator
   *  uebernimmt die aggregation. */
  skipSummary: boolean
  /** comma-separated substring filter über config-namen. matched konfigs
   *  bleiben , alle anderen werden raus-gefiltert. nützlich um aus einer
   *  früheren ranking.md die top-N namen nachzulaufen ohne configs.ts
   *  anzufassen. */
  only?: string[]
}

function parseArgs(argv: string[]): SweepArgs {
  const out: SweepArgs = { configs: 'sweep', noLlm: false, judge: false, skipSummary: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--dataset' && next !== undefined) {
      out.dataset = next
      i++
    } else if (a === '--library' && next !== undefined) {
      out.library = next
      i++
    } else if (
      a === '--configs' &&
      (next === 'default' ||
        next === 'sweep' ||
        next === 'grid' ||
        next === 'adaptive' ||
        next === 'answer')
    ) {
      out.configs = next
      i++
    } else if (a === '--iterations' && next !== undefined) {
      out.iterations = Number(next)
      // --iterations impliziert grid wenn nichts anderes gesetzt ist.
      if (out.configs === 'sweep') out.configs = 'grid'
      i++
    } else if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    } else if (a === '--no-llm') {
      out.noLlm = true
    } else if (a === '--judge') {
      out.judge = true
    } else if (a === '--judge-path' && next !== undefined) {
      out.judgePath = next
      i++
    } else if (a === '--judge-context' && next !== undefined) {
      out.judgeContext = Number(next)
      i++
    } else if (a === '--llm-models' && next !== undefined) {
      out.llmModels = next
      i++
    } else if (a === '--run-dir' && next !== undefined) {
      out.runDir = next
      i++
    } else if (a === '--skip-summary') {
      out.skipSummary = true
    } else if (a === '--only' && next !== undefined) {
      out.only = next
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      i++
    }
  }
  return out
}

async function tryWarm(target: unknown): Promise<void> {
  if (target && typeof (target as { warm?: unknown }).warm === 'function') {
    await (target as { warm: () => Promise<void> }).warm()
  }
}

async function tryUnload(target: unknown): Promise<void> {
  if (target && typeof (target as { unload?: unknown }).unload === 'function') {
    try {
      await (target as { unload: () => Promise<void> }).unload()
    } catch {
      /* best-effort */
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
