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
//
// ohne --dataset wird das jüngste file unter data/datasets/ genommen.
// --configs default → defaultConfigs() , --configs sweep → sweepConfigs().
// --limit caps wie viele questions pro config gelaufen werden (für quick smoke).
// --no-llm überschreibt alle config.llm auf null (skip TTFT-messung).

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cosineSimilarity } from './pipeline/Embedder'
import { defaultConfigs, sweepConfigs, gridConfigs, type PipelineConfig } from './pipeline/configs'
import type { Judge, JudgeScore } from './judge/Judge'
import { compositeScore } from './judge/Judge'
import type { GeneratedQuestion, SourceChunk } from './synth/QuestionGenerator'
import { recallAtK, mrr, ndcgAtK, type RankedResult } from './metrics'
import {
  PhasedTimer,
  ResourceSampler,
  summarizePhases,
  type PhasedSnapshot,
  type LatencySummary,
  type PhasedSummary,
  type ResourceSample,
} from './perf'
import { createRunDir, envSnapshot, hashBytes, type DatasetInfo } from './runDir'
import { evalChunksToHits } from './bridges/hits'
import type { LlmRunResult } from './bridges/LlmBridge'

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
  if (configs.length === 0) throw new Error('keine configs ausgewählt')
  console.error(`configs: ${configs.length} , LLM: ${configs.some((c) => c.llm) ? 'an' : 'aus'}`)

  const questions =
    args.limit !== undefined ? dataset.questions.slice(0, args.limit) : dataset.questions

  // Judge wird NICHT mehr vor dem konfig-loop geladen. Two-pass-design: erst
  // alle LLM-asks unter dem under-test-LLM durchziehen , dann sämtliche
  // bridges unloaden , dann judge laden , dann judge-pass über die in-memory
  // PerQuestionRecord-arrays. Vorteil: unter-test-LLM (5 GB) und judge-LLM
  // (18 GB Nemotron) sind nie gleichzeitig resident — auf 32 GB RAM machine
  // bleibt das system responsive. Sanity-check früh: --judge braucht configs
  // mit LLM , sonst gibt's nichts zu beurteilen.
  if (args.judge && !configs.some((c) => c.llm)) {
    throw new Error(
      `--judge braucht configs mit LLM ; --no-llm oder --configs default schließt das aus`,
    )
  }

  const runDir = await createRunDir()
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

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]!
    console.error(`\n[${i + 1}/${configs.length}] config: ${cfg.name}`)
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

  // Pass-1 ist durch — alle bridges können raus aus VRAM/RAM. Critical für
  // den judge-pass: under-test-LLM (5 GB) + judge-LLM (18 GB) gleichzeitig
  // gehen auf einer 32 GB RAM machine in den swap. Sequential = stabil.
  console.error('\nunloading under-test bridges …')
  for (const cfg of configs) {
    await tryUnload(cfg.embedder)
    await tryUnload(cfg.reranker)
    if (cfg.llm) await tryUnload(cfg.llm)
  }

  // Pass-2: judge wird jetzt geladen und scored sequenziell alle gesammelten
  // records. Ergebnisse werden in-memory aktualisiert , dann per-question.jsonl
  // + result.json pro config rewritten.
  if (args.judge) {
    const { LocalLlmJudge } = await import('./judge/LocalLlmJudge')
    const judge = new LocalLlmJudge({ profile: 'xl', contextSize: 8192 })
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

  await runDir.writeSummary(formatMarkdown(results, datasetInfo, runDir.rootDir), {
    results,
    dataset: datasetInfo,
  })
  // ranking.md separat geschrieben: gleicher datensatz , sortiert nach
  // composite-score , kürzere tabelle für den schnellen blick.
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    join(runDir.rootDir, 'ranking.md'),
    formatRanking(results, runDir.rootDir),
    'utf-8',
  )
  console.error(`\nreport: ${join(runDir.rootDir, 'summary.md')}`)
  console.error(`ranking: ${join(runDir.rootDir, 'ranking.md')}`)
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
    const record: PerQuestionRecord = {
      question: q.question,
      expectedChunkId: q.chunkId,
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
    ranked.push({ chunkIds: rerankedChunkIds, expected: q.chunkId })
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
      const score = await judge.score({
        question: r.question,
        expectedChunkText: chunkTextById.get(r.expectedChunkId) ?? '',
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
    `  recall@5=${r.recallAt5.toFixed(3)} , MRR=${r.mrr.toFixed(3)}`,
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
    `| Config | n | r@5 | r@10 | MRR | judge | TTFT p50 | TTFT p95 | FullResp p50 | qEmb | retr | rerank | prefill | rss-max MiB | cpu% | free VRAM min GB | composite |`,
    `| ------ | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: |`,
  ]
  const fmt = (n: number, d = 1): string => n.toFixed(d)
  const rows = results.map((r) =>
    [
      r.config,
      r.numQueries,
      fmt(r.recallAt5, 3),
      fmt(r.recallAt10, 3),
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
  configs: 'default' | 'sweep' | 'grid'
  /** für grid: wie viele grid-punkte aus dem cartesian-raum gelaufen werden. */
  iterations?: number
  /** für `--limit N`: cappt wie viele questions pro config. */
  limit?: number
  noLlm: boolean
  /** wenn true , wird LocalLlmJudge gewärmt und pro generierter antwort gescored. */
  judge: boolean
  /** comma-separated substring filter über config-namen. matched konfigs
   *  bleiben , alle anderen werden raus-gefiltert. nützlich um aus einer
   *  früheren ranking.md die top-N namen nachzulaufen ohne configs.ts
   *  anzufassen. */
  only?: string[]
}

function parseArgs(argv: string[]): SweepArgs {
  const out: SweepArgs = { configs: 'sweep', noLlm: false, judge: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--dataset' && next !== undefined) {
      out.dataset = next
      i++
    } else if (a === '--library' && next !== undefined) {
      out.library = next
      i++
    } else if (a === '--configs' && (next === 'default' || next === 'sweep' || next === 'grid')) {
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
