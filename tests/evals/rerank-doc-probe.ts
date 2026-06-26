// Throwaway probe: does the cross-encoder reranker HELP document/prose retrieval
// on unclear queries, or just make things worse? Mirrors tests/evals/code/run.ts
// but for prose datasets (focused-260q / xquad-de / wikipedia-survival), and
// reports the FIRST-STAGE (dense) ranking vs the RERANKED ranking so we can see
// rescue (1st-stage miss -> rerank hit) vs break (1st-stage hit -> rerank miss),
// bucketed by query "clarity" (= the gold chunk's first-stage rank).
//
//   LOKLM_EMBEDDER_PATH=.../bge-m3-Q4_K_M.gguf \
//   LOKLM_RERANKER_PATH=.../bge-reranker-v2-m3-Q4_K_M.gguf \
//   tsx tests/evals/rerank-doc-probe.ts <dataset.json> [--limit N]
//
// Dense-only first stage (same as sweep.ts; production also adds BM25+RRF, so
// absolute recall here is a touch lower than prod — but the reranker's
// directional effect is what we measure and that transfers). Embeds on GPU:
// recall is placement-invariant, this is not a timing run.

import { readFileSync } from 'node:fs'
import { EmbedderBridge } from './bridges/EmbedderBridge'
import { RerankerBridge } from './bridges/RerankerBridge'
import { cosineSimilarity } from './pipeline/Embedder'

const POOL = Number(process.env.POOL ?? 20) // how many top candidates the reranker sees (prod ~20)

interface Chunk {
  id: string
  docId: string
  text: string
}
interface Question {
  question: string
  chunkId: string
  requiredChunkIds?: string[]
}
interface Dataset {
  generator: string
  chunks: Chunk[]
  questions: Question[]
}

function rankOf(order: string[], gold: string): number {
  const i = order.indexOf(gold)
  return i // 0-based, -1 if absent
}

async function main(): Promise<void> {
  const datasetPath = process.argv[2]
  if (!datasetPath) throw new Error('usage: tsx rerank-doc-probe.ts <dataset.json> [--limit N]')
  const limIdx = process.argv.indexOf('--limit')
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity

  const ds = JSON.parse(readFileSync(datasetPath, 'utf-8')) as Dataset
  const chunks = ds.chunks
  const questions = ds.questions.slice(0, limit)
  console.error(
    `dataset: ${ds.generator} — ${chunks.length} chunks, ${questions.length} questions, POOL=${POOL}`,
  )

  const embedder = new EmbedderBridge({ placement: 'auto' })
  const reranker = new RerankerBridge({ placement: 'auto' })
  await embedder.warm()
  console.error(`embedder: ${(embedder as { name: string }).name}`)

  console.error(`embedding corpus (${chunks.length})…`)
  const corpusVecs = await embedder.embedBatch(chunks.map((c) => c.text))
  const idOf = (i: number): string => chunks[i]!.id

  interface Row {
    firstRank: number
    rerankRank: number
    top1: number
    margin: number
  }
  const rows: Row[] = []
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]!
    const qv = await embedder.embed(q.question)
    const scored = corpusVecs
      .map((v, i) => ({ i, s: cosineSimilarity(qv, v) }))
      .sort((a, b) => b.s - a.s)
    const firstOrder = scored.map((x) => idOf(x.i))
    const firstRank = rankOf(firstOrder, q.chunkId)
    // first-stage confidence signals (computable at query time — no gold needed)
    const top1 = scored[0]!.s
    const margin = top1 - (scored[1]?.s ?? 0)

    const pool = scored.slice(0, POOL)
    const trunc = Number(process.env.RERANK_TRUNC ?? 0) // chars; 0 = full text
    const ranked = await reranker.rerank(
      q.question,
      pool.map((p) => ({
        text: trunc > 0 ? chunks[p.i]!.text.slice(0, trunc) : chunks[p.i]!.text,
        initialScore: p.s,
      })),
    )
    const rerankOrderInPool = ranked.map((r) => idOf(pool[r.initialIndex]!.i))
    const rIn = rankOf(rerankOrderInPool, q.chunkId)
    // gold beyond the pool is untouched by rerank -> keeps its first-stage rank
    const rerankRank = rIn >= 0 ? rIn : firstRank
    rows.push({ firstRank, rerankRank, top1, margin })
    if ((qi + 1) % 100 === 0) console.error(`  ${qi + 1}/${questions.length}`)
  }

  await (reranker as { unload?: () => Promise<void> }).unload?.()
  await (embedder as { unload?: () => Promise<void> }).unload?.()

  const n = rows.length
  const hitAt = (key: 'firstRank' | 'rerankRank', k: number): number =>
    rows.filter((r) => r[key] >= 0 && r[key] < k).length / n
  const mrr = (key: 'firstRank' | 'rerankRank'): number =>
    rows.reduce((a, r) => a + (r[key] >= 0 ? 1 / (r[key] + 1) : 0), 0) / n
  const p = (x: number): string => (100 * x).toFixed(1).padStart(5)

  console.log(`\n==== ${ds.generator}  (n=${n}, POOL=${POOL}) ====`)
  console.log(`metric        | first-stage | + reranker`)
  console.log(`recall@1      |   ${p(hitAt('firstRank', 1))}%    |   ${p(hitAt('rerankRank', 1))}%`)
  console.log(`recall@5      |   ${p(hitAt('firstRank', 5))}%    |   ${p(hitAt('rerankRank', 5))}%`)
  console.log(
    `recall@10     |   ${p(hitAt('firstRank', 10))}%    |   ${p(hitAt('rerankRank', 10))}%`,
  )
  console.log(`MRR           |   ${p(mrr('firstRank'))}     |   ${p(mrr('rerankRank'))}`)

  const rescue5 = rows.filter(
    (r) => !(r.firstRank < 5 && r.firstRank >= 0) && r.rerankRank < 5 && r.rerankRank >= 0,
  ).length
  const break5 = rows.filter(
    (r) => r.firstRank < 5 && r.firstRank >= 0 && !(r.rerankRank < 5 && r.rerankRank >= 0),
  ).length
  const rescue1 = rows.filter((r) => r.firstRank !== 0 && r.rerankRank === 0).length
  const break1 = rows.filter((r) => r.firstRank === 0 && r.rerankRank !== 0).length
  console.log(`\n@5  rescued=${rescue5}  broken=${break5}  net=${rescue5 - break5}`)
  console.log(`@1  rescued=${rescue1}  broken=${break1}  net=${rescue1 - break1}`)

  // bucket by first-stage clarity
  const buckets: Array<[string, (r: Row) => boolean]> = [
    ['clear   (1st rank 1)', (r) => r.firstRank === 0],
    ['medium  (1st rank 2-5)', (r) => r.firstRank >= 1 && r.firstRank < 5],
    ['unclear (1st rank 6-20)', (r) => r.firstRank >= 5 && r.firstRank < POOL],
    ['lost    (1st rank >20)', (r) => r.firstRank < 0 || r.firstRank >= POOL],
  ]
  console.log(`\nby first-stage clarity — share whose gold lands in top-5:`)
  console.log(`bucket                    |    n | first@5 | rerank@5`)
  for (const [name, f] of buckets) {
    const b = rows.filter(f)
    if (!b.length) continue
    const fh = b.filter((r) => r.firstRank >= 0 && r.firstRank < 5).length
    const rh = b.filter((r) => r.rerankRank >= 0 && r.rerankRank < 5).length
    console.log(
      `${name.padEnd(25)} | ${String(b.length).padStart(4)} | ${((100 * fh) / b.length).toFixed(1).padStart(6)}% | ${((100 * rh) / b.length).toFixed(1).padStart(6)}%`,
    )
  }

  // ---- can we gate the reranker on "unclear" queries only? ----
  // A gate decides rerank yes/no from a query-time confidence signal (NO gold).
  // finalRank = gate ? rerankRank : firstRank. We want a gate that reranks few
  // queries (latency saving) while keeping recall@5/@1/MRR near "always".
  const recallOf = (rank: (r: Row) => number, k: number): number =>
    rows.filter((r) => rank(r) >= 0 && rank(r) < k).length / n
  const mrrOf = (rank: (r: Row) => number): number =>
    rows.reduce((a, r) => a + (rank(r) >= 0 ? 1 / (rank(r) + 1) : 0), 0) / n
  const report = (label: string, reranked: number, rank: (r: Row) => number): void => {
    console.log(
      `${label.padEnd(28)} | ${((100 * reranked) / n).toFixed(0).padStart(4)}% | ${p(recallOf(rank, 1))}% | ${p(recallOf(rank, 5))}% | ${p(mrrOf(rank))}`,
    )
  }
  const pctile = (xs: number[], frac: number): number => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(frac * s.length))]!
  }

  console.log(`\n==== reranker GATING — rerank only "unclear" queries ====`)
  console.log(`gate                         | rerank'd | rec@1 | rec@5 |  MRR`)
  report('never (first-stage only)', 0, (r) => r.firstRank)
  report('always (current docs)', n, (r) => r.rerankRank)
  // oracle gates (need the gold — upper bound on what a perfect detector gives):
  const oracleResc = rows.filter((r) => !(r.firstRank >= 0 && r.firstRank < 5)).length
  report('oracle: rerank if miss@5', oracleResc, (r) =>
    r.firstRank >= 0 && r.firstRank < 5 ? r.firstRank : r.rerankRank,
  )
  const oracleNot1 = rows.filter((r) => r.firstRank !== 0).length
  report('oracle: rerank if not rank-1', oracleNot1, (r) =>
    r.firstRank === 0 ? r.firstRank : r.rerankRank,
  )
  // real gates: rerank the bottom X% by a query-time confidence signal.
  for (const sigName of ['margin', 'top1'] as const) {
    const sig = rows.map((r) => (sigName === 'margin' ? r.margin : r.top1))
    for (const frac of [0.2, 0.3, 0.5]) {
      const thr = pctile(sig, frac) // rerank when signal <= thr (least confident frac)
      const gate = (r: Row): boolean => (sigName === 'margin' ? r.margin : r.top1) <= thr
      const cnt = rows.filter(gate).length
      report(`gate ${sigName}<p${(frac * 100).toFixed(0)}`, cnt, (r) =>
        gate(r) ? r.rerankRank : r.firstRank,
      )
    }
  }
  // SCALE-FREE gate: ratio = score2/score1 (1 = flat/ambiguous, 0 = top1 dominates).
  // A fixed ratio threshold should transfer across corpora/embedders far better
  // than an absolute margin — rerank when ratio >= theta (top1 NOT dominant).
  for (const theta of [0.9, 0.95, 0.98]) {
    const gate = (r: Row): boolean => (r.top1 - r.margin) / (r.top1 || 1) >= theta
    const cnt = rows.filter(gate).length
    report(`gate ratio>=${theta}`, cnt, (r) => (gate(r) ? r.rerankRank : r.firstRank))
  }
  const meanRatio = (f: (r: Row) => boolean): string => {
    const b = rows.filter(f)
    return b.length
      ? (b.reduce((a, r) => a + (r.top1 - r.margin) / (r.top1 || 1), 0) / b.length).toFixed(3)
      : '-'
  }
  console.log(`\nmean score2/score1 ratio by clarity (scale-free separability):`)
  console.log(`  clear (rank1):        ${meanRatio((r) => r.firstRank === 0)}`)
  console.log(`  medium (rank2-5):     ${meanRatio((r) => r.firstRank >= 1 && r.firstRank < 5)}`)
  console.log(`  unclear (rank6-20):   ${meanRatio((r) => r.firstRank >= 5 && r.firstRank < POOL)}`)

  // how separable are clear vs needs-rescue by the confidence signal?
  const meanMargin = (f: (r: Row) => boolean): string => {
    const b = rows.filter(f)
    return b.length ? (b.reduce((a, r) => a + r.margin, 0) / b.length).toFixed(4) : '-'
  }
  console.log(`\nmean top1-top2 margin by clarity (separability check):`)
  console.log(`  clear (rank1):        ${meanMargin((r) => r.firstRank === 0)}`)
  console.log(`  medium (rank2-5):     ${meanMargin((r) => r.firstRank >= 1 && r.firstRank < 5)}`)
  console.log(
    `  unclear (rank6-20):   ${meanMargin((r) => r.firstRank >= 5 && r.firstRank < POOL)}`,
  )
  console.log(
    `  lost (rank>20):       ${meanMargin((r) => r.firstRank < 0 || r.firstRank >= POOL)}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
