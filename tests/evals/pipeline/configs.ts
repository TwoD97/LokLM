import { FixedSizeChunker, type Chunker } from './Chunker'
import { FakeEmbedder, type Embedder } from './Embedder'
import { NoopReranker, type Reranker } from './Reranker'
// Bridges importieren electron transitiv (via src/main/services/models/paths.ts).
// Statisch geladen würden defaults sich nicht mehr unter `tsx` ohne electron-
// shim laufen lassen , daher dynamische imports innerhalb von sweepConfigs().
import type { LlmBridge } from '../bridges/LlmBridge'

// Eine PipelineConfig ist ein bundle aus chunker + embedder + reranker + den
// sweep-scalars (topKToRerank, topKToLLM) und optional einem LLM-bridge.
// Der eval-runner iteriert genau über die liste die hier exportiert wird.
//
// Hinzufügen einer neuen variante: einfach unten in defaultConfigs() oder
// sweepConfigs() einen weiteren eintrag anhängen. Die helper `cartesian()`
// am ende baut komfortabel ein cartesian product wenn man eine ganze achse
// auf einmal vergleichen möchte.

export interface PipelineConfig {
  /** stabiler name , taucht in der summary-tabelle auf. */
  name: string
  chunker: Chunker
  embedder: Embedder
  reranker: Reranker
  /** wie viele top-K kandidaten vom retrieval an den reranker übergeben werden.
   *  default 20. 0 würde reranking effektiv abschalten (siehe SkipReranker). */
  topKToRerank?: number
  /** wie viele reranked chunks dem LLM in den prompt gehen. default 5. */
  topKToLLM?: number
  /** optionaler LLM-bridge für end-to-end TTFT-messung. wenn null gesetzt ist ,
   *  läuft die config retrieval-only (alte verhalten). */
  llm?: LlmBridge | null
}

/**
 * Retrieval-only configs , vergleichbar mit dem alten run.ts. Kein LLM-load ,
 * kein TTFT. Sinnvoll als smoke-test ohne große modelle.
 */
export function defaultConfigs(): PipelineConfig[] {
  return [
    {
      name: 'fake-256-noop',
      chunker: new FixedSizeChunker({ name: 'fixed-256-32', size: 256, overlap: 32 }),
      embedder: new FakeEmbedder(64),
      reranker: new NoopReranker(),
    },
    {
      name: 'fake-512-noop',
      chunker: new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 }),
      embedder: new FakeEmbedder(64),
      reranker: new NoopReranker(),
    },
  ]
}

/**
 * Sweep-configs , benutzen die echten EmbeddingService/RerankerService/LlamaService.
 * Diese variante misst end-to-end TTFT und schreibt resource-samples.
 *
 * Achtung: jeder LlmBridge load kostet ~10-60s. Konfigs die denselben LlmBridge
 * referenzieren teilen sich die ladezeit , weil der sweep-runner die warm()-
 * deduplizierung über bridge-identität macht. Sprich: lieber EINEN LlmBridge
 * konstruieren und in mehreren configs wiederverwenden , statt n separate.
 *
 * Beispiel-bundle unten: vergleicht (rerank an/aus) × (k=5/k=8) bei gleichem
 * embedder/reranker/llm. Dominik erweitert das beim ersten echten sweep.
 */
export async function sweepConfigs(): Promise<PipelineConfig[]> {
  const [{ EmbedderBridge }, { RerankerBridge, SkipReranker }, { LlmBridge }] = await Promise.all([
    import('../bridges/EmbedderBridge'),
    import('../bridges/RerankerBridge'),
    import('../bridges/LlmBridge'),
  ])
  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const embedder = new EmbedderBridge({ placement: 'cpu' })
  const reranker = new RerankerBridge({ placement: 'auto' })
  const skipRr = new SkipReranker()
  const llm: LlmBridge = new LlmBridge({ profile: 'auto' })

  return [
    {
      name: 'cpu-emb_no-rerank_k5',
      chunker,
      embedder,
      reranker: skipRr,
      topKToRerank: 0,
      topKToLLM: 5,
      llm,
    },
    {
      name: 'cpu-emb_rerank10_k5',
      chunker,
      embedder,
      reranker,
      topKToRerank: 10,
      topKToLLM: 5,
      llm,
    },
    {
      name: 'cpu-emb_rerank20_k5',
      chunker,
      embedder,
      reranker,
      topKToRerank: 20,
      topKToLLM: 5,
      llm,
    },
    {
      name: 'cpu-emb_rerank20_k8',
      chunker,
      embedder,
      reranker,
      topKToRerank: 20,
      topKToLLM: 8,
      llm,
    },
  ]
}

/**
 * Grid-Sweep für die `--iterations N` schleife. Baut den vollen kartesischen
 * raum aus den default-achsen (rerank-topK × chunks-to-LLM × chunker) und
 * lässt den runner `--iterations` davon abschneiden. Reiht NICHT achsen die
 * teure model-reloads erfordern (LLM-profil , embedder-placement) — die
 * sollen über separate runs verglichen werden , nicht innerhalb einer
 * iteration-schleife , sonst frisst loading-time die ganze laufzeit.
 *
 * Erweitern: zusätzlichen `axes.push({...})` block unten anhängen.
 */
export async function gridConfigs(): Promise<PipelineConfig[]> {
  const [{ EmbedderBridge }, { RerankerBridge, SkipReranker }, { LlmBridge }] = await Promise.all([
    import('../bridges/EmbedderBridge'),
    import('../bridges/RerankerBridge'),
    import('../bridges/LlmBridge'),
  ])
  // Single instances per bridge → reused across all grid points. Warm()-cost
  // wird genau einmal bezahlt (LLM-load ist der teuerste schritt).
  const embedder = new EmbedderBridge({ placement: 'cpu' })
  const reranker = new RerankerBridge({ placement: 'auto' })
  const skipRr = new SkipReranker()
  const llm: LlmBridge = new LlmBridge({ profile: 'auto' })

  const baseChunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const base: PipelineConfig = {
    name: 'grid',
    chunker: baseChunker,
    embedder,
    reranker,
    topKToRerank: 20,
    topKToLLM: 5,
    llm,
  }

  // Achsen: jede ist ein liste von {name, partial}. `cartesian` baut das
  // vollständige produkt. Default-grid: 4 rerank-werte × 3 chunks-to-LLM-werte
  // = 12 grid-punkte. Passt in eine überschaubare laufzeit auf CPU-only.
  const axes: Array<{
    axis: string
    values: Array<{ name: string; partial: Partial<PipelineConfig> }>
  }> = [
    {
      axis: 'rerank',
      values: [
        { name: 'rr0', partial: { topKToRerank: 0, reranker: skipRr } },
        { name: 'rr10', partial: { topKToRerank: 10, reranker } },
        { name: 'rr20', partial: { topKToRerank: 20, reranker } },
        { name: 'rr40', partial: { topKToRerank: 40, reranker } },
      ],
    },
    {
      axis: 'k',
      values: [
        { name: 'k3', partial: { topKToLLM: 3 } },
        { name: 'k5', partial: { topKToLLM: 5 } },
        { name: 'k8', partial: { topKToLLM: 8 } },
      ],
    },
    // ZUM ERWEITERN (kosten chunk-axis ist re-embed pro punkt , also
    // langsam — daher auskommentiert , dominik aktiviert wenn benötigt):
    //
    // { axis: 'chunk', values: [
    //   { name: 'c256', partial: { chunker: new FixedSizeChunker({ name: 'fixed-256-32', size: 256, overlap: 32 }) } },
    //   { name: 'c512', partial: { chunker: baseChunker } },
    //   { name: 'c1024', partial: { chunker: new FixedSizeChunker({ name: 'fixed-1024-128', size: 1024, overlap: 128 }) } },
    // ]},
  ]

  return cartesian(base, axes)
}

/**
 * Helper: cartesian product über mehrere achsen. Jede achse ist eine liste von
 * {name, partial}-paaren; die ergebnis-configs werden über `<basename>_<n1>_<n2>…`
 * benannt. `partial` mergt nur das was es überschreibt , der rest kommt aus base.
 *
 * Beispiel:
 *   cartesian(baseConfig, [
 *     { axis: 'rr', values: [{name: 'no', partial: {topKToRerank: 0, reranker: skipRr}},
 *                            {name: '20', partial: {topKToRerank: 20, reranker: rr}}] },
 *     { axis: 'k',  values: [{name: 'k5', partial: {topKToLLM: 5}},
 *                            {name: 'k8', partial: {topKToLLM: 8}}] },
 *   ])
 * → 4 configs: base_no_k5 , base_no_k8 , base_20_k5 , base_20_k8
 */
export function cartesian(
  base: PipelineConfig,
  axes: ReadonlyArray<{
    axis: string
    values: ReadonlyArray<{ name: string; partial: Partial<PipelineConfig> }>
  }>,
): PipelineConfig[] {
  if (axes.length === 0) return [base]
  const [first, ...rest] = axes
  const upstream = cartesian(base, rest)
  const out: PipelineConfig[] = []
  for (const v of first!.values) {
    for (const cfg of upstream) {
      out.push({ ...cfg, ...v.partial, name: `${cfg.name}_${v.name}` })
    }
  }
  return out
}
