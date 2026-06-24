// run-storage-scale , CLI:
//   tsx tests/evals/scale/run-storage-scale.ts
//     [--dims 1024]                 vector dimensionality (bge-m3 / qwen3 = 1024)
//     [--steps 10000,50000,...]     vector-count checkpoints (ascending)
//     [--fill-batch 20000]          upsert batch size during the fill
//     [--queries 60]                random query vectors per checkpoint
//     [--topk 10] [--per-doc-k 6]   retrieval shape (production defaults)
//     [--chunks-per-doc 30]         documentId = chunkId / this (doc spread)
//     [--p95-break-ms 2000]         break when query p95 exceeds this
//     [--rss-break-frac 0.85]       break when RSS exceeds this fraction of total RAM
//     [--time-budget-min 25]        soft stop for the whole sweep
//     [--probe-embed|--no-probe-embed]   real-text embed throughput probe (default on)
//     [--embed-placement gpu|cpu|gpu,cpu]  where to run the probe (default cpu =
//                                   production; this size-stress run uses gpu)
//     [--embed-sample 2000]         chunks to embed for the throughput probe
//     [--embedder-path <gguf>]      default models/bge-m3-Q4_K_M.gguf
//     [--target-gb 100]             corpus size to extrapolate to
//     [--keep]                      keep the temp workspace dir on disk
//
// WHY THIS HARNESS EXISTS — the in-memory scale eval (run-scale.ts) measures
// retrieval QUALITY/latency with brute-force cosine + JS BM25; it never writes a
// byte of the real file-based stack. This one drives the ACTUAL on-disk engine
// (LanceWorkspaceStore over @lancedb/lancedb) wrapped in the ACTUAL at-rest
// crypto (EncryptedWorkspaceDir / blockCipher, decrypt-on-open / encrypt-on-close)
// to find where a workspace breaks as it grows: ingest throughput, ANN query
// latency across the 50k flat->IVF-PQ inflection, on-disk footprint, the
// encrypt-on-close + decrypt-on-open round-trip, and resident memory.
//
// Decoupled by design: synthetic unit vectors fill the store fast (content does
// not move storage limits — dims & row count do), while a SEPARATE probe embeds
// a real Wikipedia slice with bge-m3 to get honest chunks/sec. The two combine
// into a 100 GB extrapolation. SQLite/FTS5 scaling is out of scope here (its
// native module is built for Electron's ABI, not node) — flagged as follow-up.

import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat, readdir, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir, totalmem, cpus } from 'node:os'
import { fileURLToPath } from 'node:url'

import { LanceWorkspaceStore } from '../../../../src/main/services/storage/LanceWorkspaceStore'
import { EncryptedWorkspaceDir } from '../../../../src/main/services/storage/encryptedWorkspaceDir'
import { suggestIndexConfig } from '../../../../src/shared/workspaceStorage'
import { LatencyTracker, ResourceSampler, memorySnapshot, type LatencySummary } from '../../perf'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --------------------------------------------------------------------------- types

interface Args {
  dims: number
  steps: number[]
  fillBatch: number
  queries: number
  topk: number
  perDocK: number
  chunksPerDoc: number
  p95BreakMs: number
  rssBreakFrac: number
  timeBudgetMin: number
  probeEmbed: boolean
  embedPlacements: Array<'cpu' | 'gpu'>
  embedSample: number
  embedderPath?: string
  targetGb: number
  keep: boolean
}

interface Checkpoint {
  targetCount: number
  actualCount: number
  /** vectors/sec for the tranche added to reach this checkpoint. */
  ingestVecPerSec: number
  /** ms to upsert ONE production-shaped 32-row batch at this table size
   *  (LanceDB mergeInsert cost vs. table size — the production ingest path). */
  prodBatch32Ms: number
  /** ms to (re)build the ANN index at this size; 0 while flat (< 50k). */
  indexBuildMs: number
  indexed: boolean
  query: LatencySummary
  /** plaintext Lance dataset bytes in work/. */
  workBytes: number
  bytesPerVector: number
  /** incremental encrypt-on-persist time + resulting enc/ bytes. */
  persistMs: number
  encBytes: number
  rssMiB: number
  heapUsedMiB: number
  elapsedSec: number
}

interface ColdOpen {
  finalCount: number
  /** decrypt-on-open of the FULL encrypted tree — the "switch to this workspace"
   *  wall the user pays on every unlock. */
  decryptMs: number
  encBytes: number
  decryptMBps: number
}

interface EmbedProbe {
  placement: 'cpu' | 'gpu'
  dims: number
  chunks: number
  totalBytes: number
  avgBytesPerChunk: number
  wallSec: number
  chunksPerSec: number
  msPerChunk: number
  /** rough: bytes/4 as a token proxy. */
  approxTokensPerSec: number
  batch: LatencySummary
}

interface BreakInfo {
  reason: 'query-latency' | 'memory' | 'ingest-error' | 'time-budget' | 'none'
  atCount: number
  detail: string
}

// --------------------------------------------------------------------------- helpers

function unitVector(dims: number): number[] {
  const v = new Array<number>(dims)
  let s = 0
  for (let i = 0; i < dims; i++) {
    const x = Math.random() * 2 - 1
    v[i] = x
    s += x * x
  }
  const inv = 1 / (Math.sqrt(s) || 1)
  return v.map((x) => x * inv)
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(p)
    else
      total += await stat(p)
        .then((s) => s.size)
        .catch(() => 0)
  }
  return total
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${n} B`
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)} s`
  if (sec < 3600) return `${(sec / 60).toFixed(1)} min`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`
  return `${(sec / 86400).toFixed(1)} d`
}

function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}k`
  return String(n)
}

// --------------------------------------------------------------------------- the sweep

async function runSweep(
  args: Args,
): Promise<{
  checkpoints: Checkpoint[]
  coldOpen: ColdOpen | null
  brk: BreakInfo
  baseDir: string
}> {
  const base = await mkdtemp(join(tmpdir(), 'loklm-storage-scale-'))
  const wdek = randomBytes(32)
  const encDir = new EncryptedWorkspaceDir(base, wdek)
  const workDir = await encDir.open()
  const datasetDir = join(workDir, 'vectors')
  const store = new LanceWorkspaceStore({
    workspaceId: 1,
    config: suggestIndexConfig(args.dims, 0),
    datasetDir,
  })
  await store.open()

  const rssCeilMiB = (totalmem() / 1024 / 1024) * args.rssBreakFrac
  const t0 = performance.now()
  const checkpoints: Checkpoint[] = []
  let brk: BreakInfo = { reason: 'none', atCount: 0, detail: '' }
  let nextId = 0
  let prevCount = 0
  let indexed = false

  outer: for (const target of args.steps) {
    // ---- fill prevCount -> target via real upsert (LanceDB mergeInsert path) ----
    const fillStart = performance.now()
    let added = 0
    while (nextId < target) {
      const n = Math.min(args.fillBatch, target - nextId)
      const batch = new Array(n)
      for (let j = 0; j < n; j++) {
        const id = nextId + j
        batch[j] = {
          chunkId: id,
          documentId: Math.floor(id / args.chunksPerDoc),
          vector: unitVector(args.dims),
        }
      }
      try {
        await store.upsert(batch)
      } catch (err) {
        brk = {
          reason: 'ingest-error',
          atCount: nextId,
          detail: String((err as Error)?.message ?? err),
        }
        break outer
      }
      nextId += n
      added += n
      const elapsedMin = (performance.now() - t0) / 1000 / 60
      const rss = memorySnapshot().rssMiB
      if (rss > rssCeilMiB) {
        brk = {
          reason: 'memory',
          atCount: nextId,
          detail: `RSS ${rss.toFixed(0)} MiB > ceil ${rssCeilMiB.toFixed(0)} MiB`,
        }
        break outer
      }
      if (elapsedMin > args.timeBudgetMin) {
        brk = {
          reason: 'time-budget',
          atCount: nextId,
          detail: `${elapsedMin.toFixed(1)} min > budget ${args.timeBudgetMin} min`,
        }
        break outer
      }
    }
    const fillSec = (performance.now() - fillStart) / 1000
    const ingestVecPerSec = added > 0 ? added / fillSec : 0
    const actualCount = await store.count()

    // ---- production per-batch ingest probe: time ONE 32-row mergeInsert ----
    // (captures how the real ingest path degrades as the table grows)
    const pb: number[] = []
    for (let r = 0; r < 3; r++) {
      const batch = new Array(32)
      for (let j = 0; j < 32; j++) {
        const id = nextId++
        batch[j] = {
          chunkId: id,
          documentId: Math.floor(id / args.chunksPerDoc),
          vector: unitVector(args.dims),
        }
      }
      const s = performance.now()
      await store.upsert(batch)
      pb.push(performance.now() - s)
    }
    const prodBatch32Ms = pb.sort((a, b) => a - b)[Math.floor(pb.length / 2)]!

    // ---- (re)build the ANN index once past the 50k flat->IVF-PQ inflection ----
    const cfg = suggestIndexConfig(args.dims, actualCount)
    let indexBuildMs = 0
    if (cfg.numSubVectors > 0 || actualCount >= 50_000) {
      const s = performance.now()
      try {
        await store.buildIndex(cfg)
        indexed = true
      } catch (err) {
        brk = {
          reason: 'ingest-error',
          atCount: actualCount,
          detail: `buildIndex: ${String((err as Error)?.message ?? err)}`,
        }
        break outer
      }
      indexBuildMs = performance.now() - s
    }

    // ---- query latency (production shape: topK + per-doc cap) ----
    await store.search(unitVector(args.dims), args.topk, { perDocK: args.perDocK }) // warmup, untimed
    const qt = new LatencyTracker()
    for (let q = 0; q < args.queries; q++) {
      const qv = unitVector(args.dims)
      await qt.time(() => store.search(qv, args.topk, { perDocK: args.perDocK }))
    }
    const query = qt.summary()

    // ---- disk + encrypt-on-persist (incremental) ----
    const workBytes = await dirSize(datasetDir)
    const persistStart = performance.now()
    await encDir.persist()
    const persistMs = performance.now() - persistStart
    const encBytes = await dirSize(encDir.encDir)

    const mem = memorySnapshot()
    const cp: Checkpoint = {
      targetCount: target,
      actualCount,
      ingestVecPerSec,
      prodBatch32Ms,
      indexBuildMs,
      indexed,
      query,
      workBytes,
      bytesPerVector: actualCount > 0 ? workBytes / actualCount : 0,
      persistMs,
      encBytes,
      rssMiB: mem.rssMiB,
      heapUsedMiB: mem.heapUsedMiB,
      elapsedSec: (performance.now() - t0) / 1000,
    }
    checkpoints.push(cp)
    console.error(
      `  [${fmtCount(actualCount).padStart(5)}] ` +
        `ingest ${ingestVecPerSec.toFixed(0).padStart(6)} vec/s | ` +
        `prod32 ${prodBatch32Ms.toFixed(0).padStart(5)}ms | ` +
        `idx ${indexBuildMs.toFixed(0).padStart(6)}ms${indexed ? '(ivfpq)' : '(flat)'} | ` +
        `q p50 ${query.p50.toFixed(1)}/p95 ${query.p95.toFixed(1)}ms | ` +
        `disk ${fmtBytes(workBytes)} (${cp.bytesPerVector.toFixed(0)} B/vec) | ` +
        `persist ${persistMs.toFixed(0)}ms | rss ${mem.rssMiB.toFixed(0)}MiB`,
    )

    // ---- break detection ----
    if (query.p95 > args.p95BreakMs) {
      brk = {
        reason: 'query-latency',
        atCount: actualCount,
        detail: `query p95 ${query.p95.toFixed(0)} ms > ${args.p95BreakMs} ms`,
      }
      break outer
    }
    if (mem.rssMiB > rssCeilMiB) {
      brk = {
        reason: 'memory',
        atCount: actualCount,
        detail: `RSS ${mem.rssMiB.toFixed(0)} MiB > ceil ${rssCeilMiB.toFixed(0)} MiB`,
      }
      break outer
    }
    if ((performance.now() - t0) / 1000 / 60 > args.timeBudgetMin) {
      brk = {
        reason: 'time-budget',
        atCount: actualCount,
        detail: `time budget ${args.timeBudgetMin} min reached`,
      }
      break outer
    }
    prevCount = actualCount
  }
  void prevCount

  // ---- cold round-trip: close (full persist + wipe work/), reopen (decrypt-on-open) ----
  let coldOpen: ColdOpen | null = null
  try {
    const finalCount = await store.count().catch(() => 0)
    await store.close()
    await encDir.close() // persists everything, wipes plaintext work/
    const encDir2 = new EncryptedWorkspaceDir(base, wdek)
    const s = performance.now()
    const workDir2 = await encDir2.open() // decrypts the WHOLE enc tree
    const decryptMs = performance.now() - s
    const store2 = new LanceWorkspaceStore({
      workspaceId: 1,
      config: suggestIndexConfig(args.dims, finalCount),
      datasetDir: join(workDir2, 'vectors'),
    })
    await store2.open()
    const verified = await store2.count().catch(() => 0)
    const encBytes = await dirSize(encDir2.encDir)
    coldOpen = {
      finalCount: verified,
      decryptMs,
      encBytes,
      decryptMBps: decryptMs > 0 ? encBytes / 1e6 / (decryptMs / 1000) : 0,
    }
    console.error(
      `  cold-open: decrypt ${fmtBytes(encBytes)} in ${fmtDuration(decryptMs / 1000)} ` +
        `(${coldOpen.decryptMBps.toFixed(0)} MB/s), count=${verified}`,
    )
    await store2.close()
    if (!args.keep) await encDir2.close({ discard: true })
  } catch (err) {
    console.error('  cold-open round-trip failed:', (err as Error)?.message ?? err)
  }

  if (!args.keep) await rm(base, { recursive: true, force: true }).catch(() => undefined)
  return { checkpoints, coldOpen, brk, baseDir: base }
}

// --------------------------------------------------------------------------- embed probe

async function loadRealChunks(limit: number): Promise<string[]> {
  // prefer the wikipedia-survival dataset (real wiki text already on disk);
  // fall back to the survival-skills corpus split into ~2000-char chunks.
  const dsDir = join(__dirname, '..', 'data', 'datasets')
  try {
    const files = (await readdir(dsDir)).filter(
      (f) => f.includes('wikipedia') && f.endsWith('.json'),
    )
    files.sort()
    if (files.length > 0) {
      const ds = JSON.parse(await readFile(join(dsDir, files[files.length - 1]!), 'utf-8')) as {
        chunks?: Array<{ text?: string }>
      }
      const texts = (ds.chunks ?? []).map((c) => c.text ?? '').filter((t) => t.trim().length > 50)
      if (texts.length > 0) return texts.slice(0, limit)
    }
  } catch {
    /* fall through */
  }
  const corpus = await readFile(
    join(__dirname, '..', 'data', 'corpora', 'wikipedia-survival', 'survival-skills.txt'),
    'utf-8',
  )
  const out: string[] = []
  for (let i = 0; i < corpus.length && out.length < limit; i += 2000) {
    const slice = corpus.slice(i, i + 2000).trim()
    if (slice.length > 50) out.push(slice)
  }
  return out
}

async function runEmbedProbe(
  texts: string[],
  placement: 'cpu' | 'gpu',
  embedderPath: string | undefined,
): Promise<EmbedProbe> {
  const { EmbedderBridge } = await import('../../bridges/EmbedderBridge')
  const bridge = new EmbedderBridge({
    placement,
    ...(embedderPath ? { modelPath: embedderPath } : {}),
    label: `probe:${placement}`,
  })
  await bridge.warm()
  const totalBytes = texts.reduce((n, t) => n + Buffer.byteLength(t, 'utf-8'), 0)
  const batchTracker = new LatencyTracker()
  const EMBED_BATCH = 32 // production batch (DocumentService EMBED_BATCH)
  const t0 = performance.now()
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH)
    await batchTracker.time(() => bridge.embedBatch(slice))
  }
  const wallSec = (performance.now() - t0) / 1000
  const dims = bridge.dim
  await bridge.unload()
  return {
    placement,
    dims,
    chunks: texts.length,
    totalBytes,
    avgBytesPerChunk: texts.length > 0 ? totalBytes / texts.length : 0,
    wallSec,
    chunksPerSec: texts.length / wallSec,
    msPerChunk: (wallSec * 1000) / texts.length,
    approxTokensPerSec: totalBytes / 4 / wallSec,
    batch: batchTracker.summary(),
  }
}

// --------------------------------------------------------------------------- extrapolation

interface Extrapolation {
  targetGb: number
  avgBytesPerChunk: number
  projectedChunks: number
  bytesPerVector: number
  projectedLanceBytes: number
  /** enc + plaintext work/ both on disk while the workspace is open. */
  projectedOpenDiskBytes: number
  embedSecCpu: number | null
  embedSecGpu: number | null
  decryptOpenSec: number | null
  queryNote: string
}

function extrapolate(
  args: Args,
  checkpoints: Checkpoint[],
  coldOpen: ColdOpen | null,
  probes: EmbedProbe[],
): Extrapolation | null {
  if (checkpoints.length === 0) return null
  const last = checkpoints[checkpoints.length - 1]!
  const cpu = probes.find((p) => p.placement === 'cpu') ?? null
  const gpu = probes.find((p) => p.placement === 'gpu') ?? null
  const avgBytesPerChunk = cpu?.avgBytesPerChunk ?? gpu?.avgBytesPerChunk ?? 1500
  const targetBytes = args.targetGb * 1e9
  const projectedChunks = Math.round(targetBytes / avgBytesPerChunk)
  const bytesPerVector = last.bytesPerVector
  const projectedLanceBytes = projectedChunks * bytesPerVector
  return {
    targetGb: args.targetGb,
    avgBytesPerChunk,
    projectedChunks,
    bytesPerVector,
    projectedLanceBytes,
    projectedOpenDiskBytes: projectedLanceBytes * 2, // enc/ + work/ coexist while open
    embedSecCpu: cpu ? projectedChunks / cpu.chunksPerSec : null,
    embedSecGpu: gpu ? projectedChunks / gpu.chunksPerSec : null,
    decryptOpenSec:
      coldOpen && coldOpen.decryptMBps > 0
        ? projectedLanceBytes / 1e6 / coldOpen.decryptMBps
        : null,
    queryNote: last.indexed
      ? `IVF-PQ at ${fmtCount(last.actualCount)} held query p95 at ${last.query.p95.toFixed(0)} ms; ANN search is sub-linear, so query latency is NOT the wall.`
      : `still flat (brute-force) at ${fmtCount(last.actualCount)} — query p95 ${last.query.p95.toFixed(0)} ms; flat scan is linear and would degrade past 50k.`,
  }
}

// --------------------------------------------------------------------------- report

async function writeReport(
  args: Args,
  sysInfo: Record<string, unknown>,
  checkpoints: Checkpoint[],
  coldOpen: ColdOpen | null,
  brk: BreakInfo,
  probes: EmbedProbe[],
  extra: Extrapolation | null,
  resourceSamples: unknown[],
): Promise<string> {
  const outDir = join(__dirname, 'report')
  await mkdir(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const jsonPath = join(outDir, `storage-${stamp}.json`)
  const mdPath = join(outDir, `storage-${stamp}.md`)
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: stamp,
        args,
        sysInfo,
        checkpoints,
        coldOpen,
        brk,
        probes,
        extra,
        resourceSamples,
      },
      null,
      2,
    ),
    'utf-8',
  )
  await writeFile(
    mdPath,
    formatMarkdown(args, sysInfo, checkpoints, coldOpen, brk, probes, extra),
    'utf-8',
  )
  console.error(`\nreport: ${mdPath}`)
  return mdPath
}

function formatMarkdown(
  args: Args,
  sysInfo: Record<string, unknown>,
  checkpoints: Checkpoint[],
  coldOpen: ColdOpen | null,
  brk: BreakInfo,
  probes: EmbedProbe[],
  extra: Extrapolation | null,
): string {
  const lines: string[] = []
  lines.push(`# Storage-Scale-Report (file-based workspace, real LanceDB + at-rest crypto)`)
  lines.push('')
  lines.push(`- generated: ${new Date().toISOString()}`)
  lines.push(
    `- dims: ${args.dims} | fill-batch: ${args.fillBatch} | queries/cp: ${args.queries} | topK ${args.topk}, perDocK ${args.perDocK}`,
  )
  lines.push(
    `- host: ${sysInfo.cpu} , ${sysInfo.cores} cores , ${sysInfo.ramGiB} GiB RAM , node ${sysInfo.node}`,
  )
  lines.push(
    `- break thresholds: query p95 > ${args.p95BreakMs} ms , RSS > ${(args.rssBreakFrac * 100).toFixed(0)}% RAM , time budget ${args.timeBudgetMin} min`,
  )
  lines.push('')
  lines.push(`## Break point`)
  lines.push('')
  if (brk.reason === 'none') {
    lines.push(
      `No hard break inside the swept range — the sweep completed every configured checkpoint. The wall is reached via the 100 GB extrapolation below (decrypt-on-open + disk doubling), not the in-range measurements.`,
    )
  } else {
    lines.push(`**${brk.reason}** at ~${fmtCount(brk.atCount)} vectors — ${brk.detail}`)
  }
  lines.push('')
  lines.push(`## Scaling curve`)
  lines.push('')
  lines.push(
    `| vectors | ingest vec/s | prod 32-batch ms | index build ms | mode | q p50 ms | q p95 ms | q max ms | disk | B/vec | persist ms | enc size | RSS MiB |`,
  )
  lines.push(`| -: | -: | -: | -: | - | -: | -: | -: | -: | -: | -: | -: | -: |`)
  for (const c of checkpoints) {
    lines.push(
      `| ${fmtCount(c.actualCount)} | ${c.ingestVecPerSec.toFixed(0)} | ${c.prodBatch32Ms.toFixed(0)} | ${c.indexBuildMs.toFixed(0)} | ${c.indexed ? 'IVF-PQ' : 'flat'} | ${c.query.p50.toFixed(1)} | ${c.query.p95.toFixed(1)} | ${c.query.max.toFixed(1)} | ${fmtBytes(c.workBytes)} | ${c.bytesPerVector.toFixed(0)} | ${c.persistMs.toFixed(0)} | ${fmtBytes(c.encBytes)} | ${c.rssMiB.toFixed(0)} |`,
    )
  }
  lines.push('')
  if (coldOpen) {
    lines.push(`## Cold workspace open (decrypt-on-open of the full encrypted store)`)
    lines.push('')
    lines.push(
      `At ${fmtCount(coldOpen.finalCount)} vectors: decrypting ${fmtBytes(coldOpen.encBytes)} took **${fmtDuration(coldOpen.decryptMs / 1000)}** (${coldOpen.decryptMBps.toFixed(0)} MB/s). This is paid on EVERY unlock/switch into the workspace, and while open the plaintext \`work/\` copy doubles the on-disk footprint.`,
    )
    lines.push('')
  }
  if (probes.length > 0) {
    lines.push(`## Embed throughput (real Wikipedia text, bge-m3)`)
    lines.push('')
    lines.push(`| placement | dims | chunks | avg B/chunk | wall | chunks/s | ms/chunk | ~tok/s |`)
    lines.push(`| - | -: | -: | -: | -: | -: | -: | -: |`)
    for (const p of probes) {
      lines.push(
        `| ${p.placement} | ${p.dims} | ${p.chunks} | ${p.avgBytesPerChunk.toFixed(0)} | ${fmtDuration(p.wallSec)} | ${p.chunksPerSec.toFixed(1)} | ${p.msPerChunk.toFixed(1)} | ${p.approxTokensPerSec.toFixed(0)} |`,
      )
    }
    lines.push('')
  }
  if (extra) {
    lines.push(`## Extrapolation to ${extra.targetGb} GB of text`)
    lines.push('')
    lines.push(
      `- avg chunk size (measured): ${extra.avgBytesPerChunk.toFixed(0)} B → **${fmtCount(extra.projectedChunks)} chunks/vectors**`,
    )
    lines.push(
      `- LanceDB on disk: ${extra.bytesPerVector.toFixed(0)} B/vec → **${fmtBytes(extra.projectedLanceBytes)}** at rest`,
    )
    lines.push(
      `- while OPEN: enc/ + plaintext work/ coexist → **${fmtBytes(extra.projectedOpenDiskBytes)}** of disk needed`,
    )
    if (extra.embedSecCpu != null)
      lines.push(`- one-time embed (CPU, production): **${fmtDuration(extra.embedSecCpu)}**`)
    if (extra.embedSecGpu != null)
      lines.push(`- one-time embed (GPU, upper bound): **${fmtDuration(extra.embedSecGpu)}**`)
    if (extra.decryptOpenSec != null)
      lines.push(
        `- decrypt-on-open at that size: **${fmtDuration(extra.decryptOpenSec)}** PER unlock`,
      )
    lines.push(`- query latency: ${extra.queryNote}`)
    lines.push('')
  }
  lines.push(`## Out of scope (flagged follow-up)`)
  lines.push('')
  lines.push(
    `- Encrypted SQLite (meta.db) + FTS5/BM25 scaling: \`better-sqlite3-multiple-ciphers\` is built for Electron's ABI (NODE_MODULE_VERSION 146), not node (137), so it can't run in this headless harness. Needs an in-Electron run or a node-ABI rebuild (which would break the app build).`,
  )
  lines.push('')
  return lines.join('\n')
}

// --------------------------------------------------------------------------- main

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const has = (flag: string): boolean => argv.includes(flag)
  const defaultSteps = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000]
  const embedderPath = get('--embedder-path')
  return {
    dims: Number(get('--dims') ?? 1024),
    steps: (
      get('--steps')
        ?.split(',')
        .map((s) => Number(s.trim())) ?? defaultSteps
    ).sort((a, b) => a - b),
    fillBatch: Number(get('--fill-batch') ?? 20_000),
    queries: Number(get('--queries') ?? 60),
    topk: Number(get('--topk') ?? 10),
    perDocK: Number(get('--per-doc-k') ?? 6),
    chunksPerDoc: Number(get('--chunks-per-doc') ?? 30),
    p95BreakMs: Number(get('--p95-break-ms') ?? 2000),
    rssBreakFrac: Number(get('--rss-break-frac') ?? 0.85),
    timeBudgetMin: Number(get('--time-budget-min') ?? 25),
    probeEmbed: !has('--no-probe-embed'),
    embedPlacements: (
      (get('--embed-placement') ?? 'cpu').split(',').map((s) => s.trim()) as Array<'cpu' | 'gpu'>
    ).filter((p) => p === 'cpu' || p === 'gpu'),
    embedSample: Number(get('--embed-sample') ?? 2000),
    ...(embedderPath ? { embedderPath } : {}),
    targetGb: Number(get('--target-gb') ?? 100),
    keep: has('--keep'),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const sysInfo = {
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    ramGiB: (totalmem() / 1024 ** 3).toFixed(1),
    node: process.version,
    platform: process.platform,
  }
  console.error(
    `host: ${sysInfo.cpu} , ${sysInfo.cores} cores , ${sysInfo.ramGiB} GiB RAM , node ${sysInfo.node}`,
  )
  console.error(`steps: ${args.steps.map(fmtCount).join(' -> ')} | dims ${args.dims}\n`)

  const sampler = new ResourceSampler({ intervalMs: 500 })
  sampler.start()

  // --- embed throughput probe FIRST, then fully unload so the sweep RSS is clean ---
  const probes: EmbedProbe[] = []
  if (args.probeEmbed && args.embedPlacements.length > 0) {
    const texts = await loadRealChunks(args.embedSample)
    console.error(
      `embed probe: ${texts.length} real chunks on [${args.embedPlacements.join(', ')}]`,
    )
    for (const placement of args.embedPlacements) {
      try {
        const p = await runEmbedProbe(texts, placement, args.embedderPath)
        probes.push(p)
        console.error(
          `  ${placement}: ${p.chunksPerSec.toFixed(1)} chunks/s , ${p.msPerChunk.toFixed(1)} ms/chunk , dims ${p.dims}`,
        )
      } catch (err) {
        console.error(
          `  ${placement} embed probe failed (continuing):`,
          (err as Error)?.message ?? err,
        )
      }
    }
    if (global.gc) global.gc()
  }

  console.error(
    `\nstorage sweep (synthetic ${args.dims}-d unit vectors, real LanceDB + at-rest crypto):`,
  )
  const { checkpoints, coldOpen, brk } = await runSweep(args)

  const extra = extrapolate(args, checkpoints, coldOpen, probes)
  const resourceSamples = sampler.stop()

  const mdPath = await writeReport(
    args,
    sysInfo,
    checkpoints,
    coldOpen,
    brk,
    probes,
    extra,
    resourceSamples,
  )
  // echo the report to stdout so the run is self-documenting in the terminal.
  console.log('\n' + (await readFile(mdPath, 'utf-8')))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
