// Code-retrieval / noisy-query eval runner.
//
//   tsx tests/evals/code/run.ts [--placement auto|cpu] [--embedder-path <gguf>]
//       [--limit N] [--configs prod,f1_qinstr,...] [--fake] [--no-cache]
//
// Measures retrieval QUALITY (recall by query-type), not latency — so the corpus
// is embedded on the GPU by default (placement-invariant vectors; the mirror-
// production-timing rule is about TTFT, not recall). Loads the REAL bge-m3 (or
// Qwen3-Embedding via --embedder-path) + bge-reranker through the eval bridges,
// runs every ABLATIONS config over the dataset, and writes summary.md +
// ranking.md + result.json under tests/evals/code/report/<stamp>/.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeEmbedder, type Embedder } from '../pipeline/Embedder'
import { NoopReranker, type Reranker } from '../pipeline/Reranker'
import { buildContext, runQuery, type PipelineCtx } from './pipeline'
import { summarizeConfig, type QueryResult, type ConfigMetrics } from './metrics'
import { ABLATIONS } from './ablations'
import type { CodeCorpus, CodeQueryDataset, QueryType } from './types'
import { QUERY_TYPES } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, '..', 'data')
const QUERY_INSTRUCTION =
  process.env.LOKLM_EVAL_QUERY_INSTRUCTION ??
  'Represent this question to retrieve the source code that answers it:\n'

interface Args {
  placement: 'auto' | 'cpu'
  embedderPath?: string
  limit: number
  configs: Set<string> | null
  fake: boolean
  cache: boolean
}
function parseArgs(argv: string[]): Args {
  const out: Args = { placement: 'auto', limit: Infinity, configs: null, fake: false, cache: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const n = argv[i + 1]
    if (a === '--placement' && n) {
      out.placement = n as 'auto' | 'cpu'
      i++
    } else if (a === '--embedder-path' && n) {
      out.embedderPath = n
      i++
    } else if (a === '--limit' && n) {
      out.limit = Number(n)
      i++
    } else if (a === '--configs' && n) {
      out.configs = new Set(n.split(','))
      i++
    } else if (a === '--fake') {
      out.fake = true
    } else if (a === '--no-cache') {
      out.cache = false
    }
  }
  return out
}

function l2(v: number[] | Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  const n = Math.sqrt(s) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n
  return out
}

async function embedCorpus(
  embedder: Embedder,
  texts: string[],
  cacheKey: string,
  useCache: boolean,
): Promise<Float32Array[]> {
  const cacheDir = join(DATA, 'code-corpus', '.vec-cache')
  const binPath = join(cacheDir, `${cacheKey}.bin`)
  const metaPath = join(cacheDir, `${cacheKey}.json`)
  if (useCache && existsSync(binPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { n: number; dim: number }
    if (meta.n === texts.length) {
      const buf = readFileSync(binPath)
      const flat = new Float32Array(buf.buffer, buf.byteOffset, meta.n * meta.dim)
      const rows: Float32Array[] = []
      for (let i = 0; i < meta.n; i++) rows.push(flat.slice(i * meta.dim, (i + 1) * meta.dim))
      console.error(`corpus vectors: cache hit (${meta.n}×${meta.dim})`)
      return rows
    }
  }
  console.error(`corpus vectors: embedding ${texts.length} chunks…`)
  const t0 = performance.now()
  const raw = await embedder.embedBatch(texts)
  const rows = raw.map((v) => l2(v))
  const dim = rows[0]?.length ?? 0
  console.error(`  done in ${((performance.now() - t0) / 1000).toFixed(1)}s (dim ${dim})`)
  if (useCache && dim > 0) {
    mkdirSync(cacheDir, { recursive: true })
    const flat = new Float32Array(rows.length * dim)
    rows.forEach((r, i) => flat.set(r, i * dim))
    writeFileSync(binPath, Buffer.from(flat.buffer))
    writeFileSync(metaPath, JSON.stringify({ n: rows.length, dim }))
  }
  return rows
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(
    readFileSync(join(DATA, 'code-corpus', 'loklm.json'), 'utf-8'),
  ) as CodeCorpus
  const dataset = JSON.parse(
    readFileSync(join(DATA, 'code-queries', 'loklm.json'), 'utf-8'),
  ) as CodeQueryDataset
  const items = dataset.items.slice(0, args.limit)
  console.error(
    `corpus: ${corpus.chunkCount} chunks (${corpus.codeChunkCount} code, ${corpus.docChunkCount} doc)`,
  )
  console.error(`dataset: ${items.length} targets × ${QUERY_TYPES.length} phrasings`)

  // --- models (real bridges or fakes) ---
  let embedder: Embedder
  let reranker: Reranker
  let label: string
  if (args.fake) {
    embedder = new FakeEmbedder(256)
    reranker = new NoopReranker()
    label = 'fake'
  } else {
    const { EmbedderBridge } = await import('../bridges/EmbedderBridge')
    const { RerankerBridge } = await import('../bridges/RerankerBridge')
    embedder = new EmbedderBridge({
      placement: args.placement,
      ...(args.embedderPath ? { modelPath: resolve(args.embedderPath) } : {}),
      label: args.embedderPath ? args.embedderPath.split(/[\\/]/).pop()! : 'bge-m3',
    })
    reranker = new RerankerBridge({ placement: 'auto' })
    label = (embedder as { name: string }).name
  }

  // --- embeddings: corpus once (raw), queries twice (plain + instruction) ---
  const corpusVecs = await embedCorpus(
    embedder,
    corpus.chunks.map((c) => c.text),
    `${label}-${corpus.chunkCount}`,
    args.cache && !args.fake,
  )
  const needInstr = ABLATIONS.filter((a) => !args.configs || args.configs.has(a.name)).some(
    (a) => a.queryInstruction,
  )
  const flatQueries: Array<{ itemIdx: number; type: QueryType; text: string }> = []
  items.forEach((it, itemIdx) =>
    it.variants.forEach((v) => flatQueries.push({ itemIdx, type: v.type, text: v.text })),
  )
  console.error(
    `embedding ${flatQueries.length} queries (plain${needInstr ? ' + instruction' : ''})…`,
  )
  const qPlain: Float32Array[] = []
  const qInstr: Float32Array[] = []
  for (const q of flatQueries) {
    qPlain.push(l2(await embedder.embed(q.text)))
    qInstr.push(
      needInstr ? l2(await embedder.embed(QUERY_INSTRUCTION + q.text)) : qPlain[qPlain.length - 1]!,
    )
  }

  const ctx: PipelineCtx = buildContext(corpus.chunks, corpusVecs, reranker, {
    candidateK: 40,
    finalK: 10,
  })

  // --- run each config over every query ---
  const configs = ABLATIONS.filter((a) => !args.configs || args.configs.has(a.name))
  const fileOf = (chunkId: number): string => corpus.chunks[chunkId]!.file
  const allMetrics: ConfigMetrics[] = []
  for (const abl of configs) {
    const t0 = performance.now()
    const byType = new Map<QueryType, QueryResult[]>()
    for (let qi = 0; qi < flatQueries.length; qi++) {
      const q = flatQueries[qi]!
      const target = items[q.itemIdx]!.targetFile
      const qVec = abl.queryInstruction ? qInstr[qi]! : qPlain[qi]!
      const ids = await runQuery(q.text, qVec, abl, ctx)
      let rank: number | null = null
      for (let r = 0; r < ids.length; r++) {
        if (fileOf(ids[r]!) === target) {
          rank = r + 1
          break
        }
      }
      const arr = byType.get(q.type) ?? []
      arr.push({ type: q.type, rank })
      byType.set(q.type, arr)
    }
    const m = summarizeConfig(abl.name, byType)
    allMetrics.push(m)
    console.error(
      `  ${abl.name.padEnd(14)} overall R@5=${m.overall.recallAt5.toFixed(3)} ` +
        `worstNoisyR@5=${m.worstNoisyRecallAt5.toFixed(3)} gap=${m.evennessGap.toFixed(3)} ` +
        `(${((performance.now() - t0) / 1000).toFixed(1)}s)`,
    )
  }

  if (embedder instanceof Object && 'unload' in embedder) {
    await (embedder as { unload?: () => Promise<void> }).unload?.()
  }
  await (reranker as { unload?: () => Promise<void> }).unload?.()

  writeReport(allMetrics, { corpus, label, nItems: items.length })
}

function fmt(n: number): string {
  return n.toFixed(3)
}

function writeReport(
  metrics: ConfigMetrics[],
  meta: { corpus: CodeCorpus; label: string; nItems: number },
): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join(__dirname, 'report', stamp)
  mkdirSync(outDir, { recursive: true })

  const header = [
    `# Code-retrieval eval — by query-type recall`,
    ``,
    `- Embedder: ${meta.label}  ·  Reranker: bge-reranker-v2-m3`,
    `- Corpus: ${meta.corpus.chunkCount} chunks (${meta.corpus.codeChunkCount} code, ${meta.corpus.docChunkCount} doc)`,
    `- Targets: ${meta.nItems} · Query instruction: \`${QUERY_INSTRUCTION.replace(/\n/g, '⏎')}\``,
    ``,
    `**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).`,
    `**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.`,
    ``,
    `| Config | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy | gap | overall R@1 | R@5 | R@10 | MRR |`,
    `| --- | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: | -: |`,
  ]
  const r5 = (m: ConfigMetrics, t: QueryType): string =>
    fmt(m.byType.find((x) => x.group === t)?.recallAt5 ?? 0)
  const ranked = metrics.slice().sort((a, b) => b.worstNoisyRecallAt5 - a.worstNoisyRecallAt5)
  const rows = ranked.map(
    (m) =>
      `| ${m.config} | ${r5(m, 'exact-symbol')} | ${r5(m, 'nl-description')} | ${r5(m, 'paraphrase')} | ` +
      `${r5(m, 'vague')} | ${r5(m, 'misspelled')} | **${fmt(m.worstNoisyRecallAt5)}** | ${fmt(m.evennessGap)} | ` +
      `${fmt(m.overall.recallAt1)} | ${fmt(m.overall.recallAt5)} | ${fmt(m.overall.recallAt10)} | ${fmt(m.overall.mrr)} |`,
  )
  const summary = [...header, ...rows, ''].join('\n')
  writeFileSync(join(outDir, 'summary.md'), summary, 'utf-8')
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(metrics, null, 2), 'utf-8')
  console.error(`\n${summary}`)
  console.error(`report: ${join(outDir, 'summary.md')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
