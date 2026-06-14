// matrix-manifest , reine Helfer für den Matrix-Lauf:
//  - parseShard / selectShard : deterministische, disjunkte Modell-Aufteilung
//    über mehrere Pods (round-robin per Index).
//  - buildMatrixManifest : Pre-Run-Zusammenfassung (kommt in Task 2).
// Bewusst ohne Modell-/GPU-Abhängigkeit, damit unit-testbar.

export interface Shard {
  index: number
  total: number
}

/** The chunker axis of the matrix — single source of truth, used by both
 *  matrixConfigs() (builds FixedSizeChunker) and run-pack --summary.
 *
 *  NUR EINE Größe: sweep.ts re-chunkt NICHT pro Config (es nutzt den
 *  vor-gechunkten `dataset.chunks`), daher wäre eine Mehr-Größen-Achse hier
 *  wirkungslos (3× identische Ergebnisse). Der Chunk-Größen-Vergleich läuft
 *  korrekt als separate Läufe: pro Größe ein eigenes Dataset bauen
 *  (build-lap-dataset mit anderem Chunker) und über die span-recall-Metrik
 *  (chunker-unabhängige goldSpans) vergleichen. Diese Größe muss zum Chunking
 *  des verwendeten Datasets passen (LAP-Dataset = 512/64). */
export const MATRIX_CHUNKER_SPECS: ReadonlyArray<{ name: string; size: number; overlap: number }> =
  [{ name: 'fixed-512-64', size: 512, overlap: 64 }]
/** chunker.name list for display/manifest. */
export const MATRIX_CHUNKER_NAMES: string[] = MATRIX_CHUNKER_SPECS.map((s) => s.name)

/** Parse "i/n" (0-based index, i < n). Wirft bei Unsinn. */
export function parseShard(s: string): Shard {
  const m = /^(\d+)\/(\d+)$/.exec(s.trim())
  if (!m) throw new Error(`--shard muss "i/n" sein (z.B. 0/4) , war: ${s}`)
  const index = Number(m[1])
  const total = Number(m[2])
  if (total < 1) throw new Error(`--shard total muss >= 1 sein , war: ${total}`)
  if (index < 0 || index >= total)
    throw new Error(`--shard index muss 0..${total - 1} sein , war: ${index}`)
  return { index, total }
}

/** Round-robin-Slice: Pod `index` bekommt jedes `total`-te Element. Union aller
 *  Shards == Eingabe , keine Überlappung. */
export function selectShard<T>(items: T[], index: number, total: number): T[] {
  return items.filter((_, i) => i % total === index)
}

export interface ManifestInput {
  embedders: { label: string }[]
  rerankers: { label: string }[]
  chunkers: string[]
  models: { label: string }[]
  dataset: {
    path: string
    numChunks: number
    numQuestions: number
    numRefusal: number
    langs: Record<string, number>
  }
  /** seconds per answer+judge run for the runtime estimate. */
  secondsPerRun?: number
  /** present when this run is one shard of n. */
  shard?: Shard
}

export interface Manifest {
  retrievalConfigs: number
  cells: number
  runs: number
  markdown: string
}

export function buildMatrixManifest(input: ManifestInput): Manifest {
  const rerankAxis = input.rerankers.length + 1 // + SkipReranker
  const retrievalConfigs = input.embedders.length * rerankAxis * input.chunkers.length
  const cells = retrievalConfigs * input.models.length
  const runs = cells * input.dataset.numQuestions
  const secs = input.secondsPerRun ?? 20
  const totalHours = (runs * secs) / 3600

  const langStr = Object.entries(input.dataset.langs)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const lines: string[] = [
    `# Matrix Pre-Run Manifest`,
    ``,
    input.shard
      ? `**Shard ${input.shard.index}/${input.shard.total}**`
      : `**Single run (no sharding)**`,
    ``,
    `## Embedder (${input.embedders.length})`,
    ...input.embedders.map((e) => `- ${e.label}`),
    ``,
    `## Reranker (${input.rerankers.length + 1})`,
    `- SkipReranker (kein Rerank)`,
    ...input.rerankers.map((r) => `- ${r.label}`),
    ``,
    `## Chunker (${input.chunkers.length})`,
    ...input.chunkers.map((c) => `- ${c}`),
    ``,
    `## Antwort-LLMs (${input.models.length}${input.shard ? ` , dieser Shard` : ``})`,
    ...input.models.map((m) => `- ${m.label}`),
    ``,
    `## Daten`,
    `- Dataset: ${input.dataset.path}`,
    `- Chunks: ${input.dataset.numChunks}`,
    `- Fragen: ${input.dataset.numQuestions} (davon ${input.dataset.numRefusal} Refusal) , Sprache: ${langStr}`,
    ``,
    `## Größe`,
    `- Retrieval-Configs (Emb × [Skip+RR] × Chunk): **${retrievalConfigs}**`,
    `- Zellen (× ${input.models.length} LLMs): **${cells}**`,
    `- Läufe (× ${input.dataset.numQuestions} Fragen, Antwort+Judge): **${runs.toLocaleString('de-DE')}**`,
    `- Grobe Laufzeit @ ${secs}s/Lauf: **~${totalHours.toFixed(0)} GPU-Stunden** (${(totalHours / 24).toFixed(1)} Tage seriell)`,
    ``,
  ]
  return { retrievalConfigs, cells, runs, markdown: lines.join('\n') }
}
