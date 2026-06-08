import { describe, it, expect } from 'vitest'
import { matrixConfigs } from '../evals/pipeline/configs'

// matrixConfigs() baut den default-matrix-sweep: 1 embedder × 1 chunker ×
// 2 reranker-varianten = 2 configs , die ohne weitere downloads laufen.
//
// Diese tests sichern die STRUKTUR der configs (nicht die mess-werte — die
// kommen aus dem sweep selbst). Zwei invarianten sind dabei load-bearing:
//   1. genau die 2 vorgeschriebenen configs (norr / bge-rr)
//   2. embedder/chunker/llm werden als EINE instanz geteilt — cache-key und
//      warm()-dedup hängen an objekt-identität , nicht an werten. Wird das
//      verletzt , embeddet jede config das korpus neu (still , kein fehler).
describe('matrixConfigs', () => {
  it('liefert den vorgeschriebenen 2-config-default', async () => {
    const configs = await matrixConfigs()

    // genau 2 configs (1 emb × 1 chunk × 2 rerank-varianten)
    expect(configs).toHaveLength(2)

    // stabile namen — der cartesian()-helfer hängt die achsen-labels an base an
    expect(configs.map((c) => c.name)).toEqual(['matrix_norr', 'matrix_bge-rr'])

    // rerank-discrimination: topKToRerank=0 schaltet reranking ab , die
    // bge-variante reicht 20 kandidaten an den reranker.
    const norr = configs.find((c) => c.name === 'matrix_norr')
    const bgeRr = configs.find((c) => c.name === 'matrix_bge-rr')
    expect(norr?.topKToRerank).toBe(0)
    expect(bgeRr?.topKToRerank).toBe(20)

    // und es sind wirklich zwei verschiedene reranker-instanzen (skip vs bge)
    expect(norr?.reranker).not.toBe(bgeRr?.reranker)
  })

  it('teilt embedder/chunker/llm als EINE instanz (cache-reuse + warm-dedup)', async () => {
    const configs = await matrixConfigs()

    // identitäts-invariante: derselbe embedder + chunker über alle configs ,
    // sonst greift der cache-key `${embedder.name}::${chunker.name}::...` nicht
    // und das korpus wird pro config neu eingebettet.
    expect(
      configs.every(
        (c) => c.embedder === configs[0]!.embedder && c.chunker === configs[0]!.chunker,
      ),
    ).toBe(true)

    // EINE geteilte , non-null LLM-instanz (auf 'full' gepinnt). Geteilte
    // identität → der sweep-runner bezahlt den LLM-load genau einmal.
    expect(configs.every((c) => !!c.llm && c.llm === configs[0]!.llm)).toBe(true)
  })
})
