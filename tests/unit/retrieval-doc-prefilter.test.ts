import { describe, it, expect, vi } from 'vitest'
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { Database } from '@main/db/database'
import type { ProviderRegistry } from '@main/services/providers/Registry'

// Hierarchical doc pre-filter (ADR-0003): docPrefilter narrows chunk retrieval
// to the top documents by summary-embedding similarity BEFORE the chunk search.
// The SQL (topDocumentsBySummarySimilarity) is tx-tested; this pins the
// RetrievalService wiring — that the narrowed ids reach searchChunks, that an
// empty result is a no-op, and that the flag defaults off.

function buildRetrieval(opts: {
  topDocs?: Array<{ id: number; score: number }>
  embedderReady?: boolean
}): {
  rs: RetrievalService
  searchChunks: ReturnType<typeof vi.fn>
  topDocs: ReturnType<typeof vi.fn>
} {
  const searchChunks = vi.fn().mockResolvedValue([])
  const searchChunksByVector = vi.fn().mockResolvedValue([])
  const topDocs = vi.fn().mockResolvedValue(opts.topDocs ?? [])
  const db = {
    documents: () => ({
      searchChunks,
      searchChunksByVector,
      topDocumentsBySummarySimilarity: topDocs,
    }),
  } as unknown as Database

  const embed = vi.fn().mockResolvedValue([new Float32Array([1, 0, 0])])
  const embedder = { isReady: () => opts.embedderReady ?? true, embed, dimension: () => 3 }
  // llm not ready → cpuMode auto-detect returns false , multiQuery/expansion off
  const llm = { isReady: () => false }
  const reranker = { isReady: () => false }
  const registry = {
    embedder: () => embedder,
    llm: () => llm,
    reranker: () => reranker,
  } as unknown as ProviderRegistry

  return { rs: new RetrievalService(db, registry), searchChunks, topDocs }
}

// Flat options that keep the pipeline to retrieve→fuse (no rerank / expand /
// whole-doc / neighbour / diversity), so searchChunks' opts are easy to assert.
const FLAT = {
  rerank: false,
  multiQuery: false,
  wholeDocFallback: false,
  documentDiversity: false,
  neighbourRadius: 0,
} as const

describe('RetrievalService doc pre-filter', () => {
  it('narrows chunk retrieval to the top documents by summary similarity', async () => {
    const { rs, searchChunks, topDocs } = buildRetrieval({
      topDocs: [
        { id: 7, score: 0.9 },
        { id: 9, score: 0.8 },
      ],
    })
    await rs.search(1, 'wave equation', 5, { ...FLAT, docPrefilter: true })
    expect(topDocs).toHaveBeenCalledWith(1, [1, 0, 0], 5, { activeDocumentIds: null })
    // every chunk search this turn is constrained to the prefiltered doc set
    for (const call of searchChunks.mock.calls) {
      expect(call[3]).toMatchObject({ activeDocumentIds: [7, 9] })
    }
    expect(searchChunks).toHaveBeenCalled()
  })

  it('intersects within an existing source-focus pin', async () => {
    const { rs, topDocs } = buildRetrieval({ topDocs: [{ id: 7, score: 0.9 }] })
    await rs.search(1, 'wave equation', 5, {
      ...FLAT,
      docPrefilter: true,
      activeDocumentIds: [7, 8, 9],
    })
    expect(topDocs).toHaveBeenCalledWith(1, [1, 0, 0], 5, { activeDocumentIds: [7, 8, 9] })
  })

  it('no summary matches → no narrowing (never starves recall)', async () => {
    const { rs, searchChunks, topDocs } = buildRetrieval({ topDocs: [] })
    await rs.search(1, 'wave equation', 5, { ...FLAT, docPrefilter: true })
    expect(topDocs).toHaveBeenCalled()
    for (const call of searchChunks.mock.calls) {
      expect(call[3]).toMatchObject({ activeDocumentIds: null })
    }
  })

  it('flag defaults off — no summary-similarity lookup', async () => {
    const { rs, topDocs } = buildRetrieval({ topDocs: [{ id: 7, score: 0.9 }] })
    await rs.search(1, 'wave equation', 5, { ...FLAT })
    expect(topDocs).not.toHaveBeenCalled()
  })

  it('skips the pre-filter when the embedder is not ready', async () => {
    const { rs, topDocs } = buildRetrieval({
      topDocs: [{ id: 7, score: 0.9 }],
      embedderReady: false,
    })
    await rs.search(1, 'wave equation', 5, { ...FLAT, docPrefilter: true })
    expect(topDocs).not.toHaveBeenCalled()
  })
})
