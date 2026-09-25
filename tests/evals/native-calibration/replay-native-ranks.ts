/** Offline only: reuses recorded native retrieval rankings. No index/model calls.
 * Run: pnpm exec tsx tests/evals/native-calibration/replay-native-ranks.ts [new-output.json]
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SearchHit } from '../../../src/main/db/types'
import { fuseRrfLists } from '../../../src/main/services/retrieval/rrf'
import {
  applyTitleBoost,
  applyShortChunkPenalty,
  applyRecencyBoost,
  applyLanguageMatchBoost,
  applyCodeSymbolBoost,
  applyCodeFilenameBoost,
  ensureCodeShare,
  extractCodeIdentifiers,
} from '../../../src/main/services/retrieval/heuristics'
import { diversifyByDocument } from '../../../src/main/services/retrieval/RetrievalService'
import type { CalibrationManifest } from './schema'

interface Chunk {
  id: number
  ordinal: number
  text: string
  headingPath: string[] | null
  pageFrom: number | null
  pageTo: number | null
  language: SearchHit['language']
}
interface Source {
  id: number
  title: string
  sourceKey: string
  addedAt: number
  chunks: Chunk[]
}
interface ArmHit {
  chunk: number
  doc: number
  rank: number
  score: number
}
interface Arm {
  variant: number
  lexical: ArmHit[]
  dense: ArmHit[]
}
interface Trace {
  ts: string
  query: string
  variants: string[]
  codeWorkspace: boolean
  rerank: boolean
  candidateK: number
  effectiveTopK: number
  thresholds: { nativeCosine: number }
  arms: Arm[]
  candidates: Array<{ chunk: number; doc: number; adjustedScore: number | null }>
  final: Array<{ chunk: number; doc: number; file: string; score: number }>
}

// Independently checked against the source text and baseline manual.json.
// These are decisive passages, not all chunks belonging to an expected document.
const facts: Record<string, Array<{ key: string; proof: string; label: string }>> = {
  'dev-01': [{ key: '1:2', proof: '48260', label: '2025 recorded revenue' }],
  'dev-02': [{ key: '1:2', proof: '184', label: '2025 completed inspections' }],
  'dev-03': [{ key: '2:4', proof: '2026-03-09', label: '2026 plan approval date' }],
  'dev-04': [{ key: '6:9', proof: '18.4', label: 'Neral sample mass and kg unit' }],
  'dev-05': [
    {
      key: '6:9',
      proof: 'Neral | 27 | 2 | 18.4\nBexin | 35 | 3 | 22.7',
      label: 'accepted trays, excluding rejected',
    },
  ],
  'dev-06': [
    { key: '1:2', proof: '48260', label: '2025 actual revenue' },
    { key: '2:5', proof: '53780', label: '2026 target revenue' },
  ],
  'dev-07': [{ key: '3:6', proof: 'MSX-417', label: 'draft A batch identifier' }],
  'dev-08': [{ key: '5:8', proof: 'Math.min(4, remaining)', label: 'reservation function' }],
  'dev-09': [], // No passage asserts a CFO name; rank metrics are not meaningful.
  'dev-10': [
    { key: '3:6', proof: '2026-10-14', label: 'draft A conflicting deadline' },
    { key: '4:7', proof: '2026-10-21', label: 'draft B conflicting deadline' },
  ],
  'dev-11': [{ key: '5:8', proof: 'Math.min(4, remaining)', label: 'reservation function' }],
  'dev-12': [
    { key: '6:9', proof: 'temperature', label: 'explicit absence of temperature measurements' },
  ],
}

const root = resolve('tests/evals/native-calibration')
const rawText = await readFile(resolve(root, 'reports/dev-4k-baseline/raw.json'), 'utf8')
const traceText = await readFile(resolve(root, 'reports/dev-4k-baseline/retrieval.log'), 'utf8')
const raw = JSON.parse(rawText) as { documents: Source[] }
const manifest = JSON.parse(
  await readFile(resolve(root, 'dev.json'), 'utf8'),
) as CalibrationManifest
const traces = traceText
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line) as Trace)
const chunks = new Map<string, { source: Source; chunk: Chunk }>()
for (const source of raw.documents)
  for (const chunk of source.chunks) chunks.set(`${source.id}:${chunk.id}`, { source, chunk })
const key = (hit: SearchHit): string => `${hit.document_id}:${hit.chunk_id}`

function replay(
  trace: Trace,
  language: 'en' | 'de',
  clean: boolean,
  penalty: number,
  boost: number,
) {
  if (trace.codeWorkspace || trace.rerank)
    throw new Error('This replay supports document/no-reranker traces only')
  const selected = clean ? trace.arms.filter((a) => a.variant === 0) : trace.arms
  if (clean && selected.length !== 1) throw new Error('Missing unique clean arm0')
  const query = clean ? trace.variants[0]! : trace.query
  const hydrate = (arm: ArmHit, kind: 'lexical' | 'dense'): SearchHit => {
    const item = chunks.get(`${arm.doc}:${arm.chunk}`)
    if (!item) throw new Error(`Unknown native chunk ${arm.doc}:${arm.chunk}`)
    const { source, chunk } = item
    return {
      chunk_id: chunk.id,
      document_id: source.id,
      // trace.final.file may be a display heading; title boost reads DB title.
      document_title: source.title,
      ordinal: chunk.ordinal,
      page_from: chunk.pageFrom,
      page_to: chunk.pageTo,
      heading_path: chunk.headingPath,
      text: chunk.text,
      added_at: source.addedAt,
      language: chunk.language,
      score: arm.score,
      ...(kind === 'lexical' ? { bm25Score: arm.score } : { cosineScore: arm.score }),
    }
  }
  const all = fuseRrfLists(
    selected.flatMap((arm) => [
      { hits: arm.lexical.map((hit) => hydrate(hit, 'lexical')) },
      { hits: arm.dense.map((hit) => hydrate(hit, 'dense')) },
    ]),
    Number.POSITIVE_INFINITY,
  )
  const eligible = all.filter(
    (hit) => hit.bm25Score !== undefined || (hit.cosineScore ?? 0) >= trace.thresholds.nativeCosine,
  )
  const weak = all.length > 0 && eligible.length === 0
  let hits = (weak ? all : eligible).slice(0, trace.candidateK)
  hits = applyTitleBoost(hits, query, 1.25)
  hits = applyShortChunkPenalty(hits, penalty, 200)
  // Preserve the original recency window without modifying imported timestamps.
  const originalNow = Date.now
  try {
    Date.now = () => Date.parse(trace.ts)
    hits = applyRecencyBoost(hits, 1.1, 10 * 60 * 1000)
  } finally {
    Date.now = originalNow
  }
  hits = applyLanguageMatchBoost(hits, language, boost)
  hits = applyCodeSymbolBoost(hits, query, 1.8, 1.4, 1)
  hits = applyCodeFilenameBoost(hits, query, 1.3, 'exact')
  hits = hits.slice().sort((a, b) => b.score - a.score)
  if (weak) hits = hits.slice(0, 1)
  const ranked = diversifyByDocument(hits, trace.effectiveTopK)
  const final =
    extractCodeIdentifiers(query).length > 0
      ? ensureCodeShare(
          ranked,
          hits,
          trace.effectiveTopK,
          Math.max(1, Math.ceil(trace.effectiveTopK * 0.4)),
        )
      : ranked
  return { all, adjusted: hits, final }
}

const configs = [
  { id: 'original-all-arms', clean: false, penalty: 0.7, boost: 1.1 },
  { id: 'clean-short0.7-lang1.1', clean: true, penalty: 0.7, boost: 1.1 },
  { id: 'clean-short1-lang1.1', clean: true, penalty: 1, boost: 1.1 },
  { id: 'clean-short0.7-lang1', clean: true, penalty: 0.7, boost: 1 },
  { id: 'clean-short1-lang1', clean: true, penalty: 1, boost: 1 },
]
const rows = manifest.cases.map((item) => {
  const trace = traces.find((row) => row.query === item.question)
  if (!trace) throw new Error(`No original trace for ${item.id}`)
  const decisive = facts[item.id]
  if (!decisive) throw new Error(`No reviewed fact definition for ${item.id}`)
  for (const fact of decisive)
    if (!chunks.get(fact.key)?.chunk.text.includes(fact.proof))
      throw new Error(`Fact anchor mismatch ${item.id} ${fact.key}`)
  const runs = configs.map((config) => {
    const result = replay(trace, item.language, config.clean, config.penalty, config.boost)
    if (!config.clean) {
      const observed = trace.final.map((hit) => `${hit.doc}:${hit.chunk}`)
      if (JSON.stringify(result.final.map(key)) !== JSON.stringify(observed))
        throw new Error(`Original final ranking parity failed for ${item.id}`)
      for (const hit of result.adjusted) {
        const observedScore = trace.candidates.find(
          (row) => row.chunk === hit.chunk_id,
        )?.adjustedScore
        if (observedScore == null || Math.abs(hit.score - observedScore) > 1e-10)
          throw new Error(
            `Original adjusted score parity failed for ${item.id} ${key(hit)}: ${hit.score} != ${observedScore}`,
          )
      }
    }
    return {
      config: config.id,
      order: result.final.map(key),
      facts: decisive.map((fact) => ({
        ...fact,
        rank: result.final.findIndex((hit) => key(hit) === fact.key) + 1 || null,
        fusedRank: result.all.findIndex((hit) => key(hit) === fact.key) + 1 || null,
        chars: chunks.get(fact.key)!.chunk.text.length,
        cosine: result.all.find((hit) => key(hit) === fact.key)?.cosineScore ?? null,
      })),
    }
  })
  return {
    caseId: item.id,
    question: trace.variants[0],
    kind: item.kind,
    expectedAbstention: item.expectedAbstention,
    runs,
  }
})
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const report = {
  kind: 'offline-native-rank-replay',
  generatedAt: new Date().toISOString(),
  rawSha256: sha(rawText),
  traceSha256: sha(traceText),
  originalParityCases: rows.length,
  limitations: [
    'Frozen baseline native lexical/dense rankings; no new queries, vectors, models, or GPU calls.',
    'Only the clean first retrieval arm is replayed; this does not measure rewritten-query model quality.',
    'Exact decisive fact passages are manually mapped from this small DEV corpus; no heldout data opened.',
    'Rank movements do not establish answer quality, refusal reliability, or citation correctness.',
    'The nine-chunk corpus fits topK10; ranking changes do not prove recall improvements on a larger corpus.',
  ],
  sourceHashes: Object.fromEntries(
    await Promise.all(
      [
        'src/main/services/retrieval/rrf.ts',
        'src/main/services/retrieval/heuristics.ts',
        'src/main/services/retrieval/RetrievalService.ts',
      ].map(async (path) => [path, sha(await readFile(path, 'utf8'))]),
    ),
  ),
  rows,
}
const output = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, 'reports/dev-4k-baseline/offline-rank-replay.json')
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(`Original rank/score parity passed for ${rows.length} cases. Wrote ${output}`)
for (const row of rows)
  console.log(
    `${row.caseId}: ${row.runs.map((run) => `${run.config}=[${run.facts.map((f) => `${f.key}@${f.rank}`).join(',')}]`).join(' | ')}`,
  )
