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
  // Pin to 'full' to match gridConfigs/adaptiveTopKConfigs , 'auto' would
  // resolve to the XL model (Nemotron) when it's present in models/ (for the
  // judge), making the under-test LLM identical to the judge and producing a
  // self-bias result. The judge is locked to XL inside LocalLlmJudge; the
  // under-test slot must stay distinct.
  const llm: LlmBridge = new LlmBridge({ profile: 'full' })

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
 * Drei Punkte für den Adaptive-TopK-Eval: misst , ob das in
 * QAService.classifyQueryBreadth implementierte Heuristik (focused=3 ,
 * broad=8 , summary=12) tatsächlich auf einem broad/summary-Datensatz
 * Mehrwert bringt. Selber embedder/reranker/LLM für alle drei Punkte ,
 * nur topKToLLM variiert.
 *
 * Datensatz muss intent + requiredChunkIds tragen , sonst entartet die
 * Metrik zu klassischem single-relevant recall@K und der Test verliert
 * Aussagekraft.
 */
export async function adaptiveTopKConfigs(): Promise<PipelineConfig[]> {
  const [{ EmbedderBridge }, { RerankerBridge }, { LlmBridge }] = await Promise.all([
    import('../bridges/EmbedderBridge'),
    import('../bridges/RerankerBridge'),
    import('../bridges/LlmBridge'),
  ])
  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const embedder = new EmbedderBridge({ placement: 'cpu' })
  const reranker = new RerankerBridge({ placement: 'auto' })
  // Pin auf 'full' (Qwen3-8B) , gleiche Begründung wie bei gridConfigs():
  // 'auto' würde den XL-judge fälschlich als under-test mounten.
  const llm: LlmBridge = new LlmBridge({ profile: 'full' })
  // topKToRerank=20 für alle drei , damit der einzige Unterschied der
  // Zuschnitt am Ende ist , nicht die Reranker-Stufe.
  return [
    { name: 'adaptive_k3_rr20', chunker, embedder, reranker, topKToRerank: 20, topKToLLM: 3, llm },
    { name: 'adaptive_k8_rr20', chunker, embedder, reranker, topKToRerank: 20, topKToLLM: 8, llm },
    {
      name: 'adaptive_k12_rr20',
      chunker,
      embedder,
      reranker,
      topKToRerank: 20,
      topKToLLM: 12,
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
  //
  // LLM-profil ist hier auf 'full' (Qwen3-8B) gepinnt , NICHT 'auto'. Sonst
  // würde resolveLlmPath('auto') das XL-modell (Nemotron 30B-A3B) finden
  // sobald es in models/ liegt (für den judge symlinked) und das wäre dann
  // auch das under-test-LLM — selbstbewertungs-bias UND massive VRAM-last.
  // Pin auf 'full' macht den under-test sauber vom judge getrennt.
  const embedder = new EmbedderBridge({ placement: 'cpu' })
  const reranker = new RerankerBridge({ placement: 'auto' })
  const skipRr = new SkipReranker()
  const llm: LlmBridge = new LlmBridge({ profile: 'full' })

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

  // Achsen: focused search variant. Erster judge-run hat gezeigt , dass
  // rr20/rr40 strictly schlechter als rr10 sind und k=8 nichts gegenüber
  // k=5 bringt. Hier auf kleinere werte verschoben um den "wenig aber
  // selektiv"-bereich auszuleuchten. 4 rerank × 3 k = 12 grid-punkte ,
  // --iterations N schneidet ab.
  const axes: Array<{
    axis: string
    values: Array<{ name: string; partial: Partial<PipelineConfig> }>
  }> = [
    {
      axis: 'rerank',
      values: [
        { name: 'rr0', partial: { topKToRerank: 0, reranker: skipRr } },
        { name: 'rr3', partial: { topKToRerank: 3, reranker } },
        { name: 'rr5', partial: { topKToRerank: 5, reranker } },
        { name: 'rr10', partial: { topKToRerank: 10, reranker } },
      ],
    },
    {
      axis: 'k',
      values: [
        { name: 'k2', partial: { topKToLLM: 2 } },
        { name: 'k3', partial: { topKToLLM: 3 } },
        { name: 'k5', partial: { topKToLLM: 5 } },
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
