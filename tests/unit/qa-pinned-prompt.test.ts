import { describe, it, expect, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import type { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import type { Database } from '@main/db/database'
import type { RetrievalHit, StreamEvent } from '@shared/documents'
import type { AskOptions } from '@main/services/llm/LlamaService'

// Pinned chunks must reach the provider SEPARATELY from RAG hits (not merged
// into one array) so buildPrompt can render them as the leading section — the
// stable token prefix that node-llama-cpp's sequence alignment reuses across
// turns. Citations still cover both, pinned first, so the UI chips match the
// full set of chunks the model saw.
describe('QAService.answer pinned-hit plumbing', () => {
  it('passes pinned hits via opts.pinnedHits and RAG hits as the positional arg', async () => {
    const ragHit = {
      chunk_id: 21,
      document_id: 2,
      document_title: 'Rag Doc',
      ordinal: 0,
      page_from: null,
      page_to: null,
      heading_path: null,
      text: 'rag fact',
      score: 0.5,
      language: null,
    } as unknown as RetrievalHit

    const pinnedChunk = {
      id: 11,
      document_id: 1,
      ordinal: 0,
      page_from: null,
      page_to: null,
      heading_path: null,
      text: 'pinned fact',
      language: null,
    }

    let capturedHits: RetrievalHit[] | undefined
    let capturedOpts: AskOptions | undefined
    const llm = {
      setLanguage: vi.fn().mockResolvedValue(undefined),
      contextWindowTokens: () => 0,
      isReady: () => true,
      ask: vi.fn(async (_q: string, hits: RetrievalHit[], opts: AskOptions) => {
        capturedHits = hits
        capturedOpts = opts
        return 'answer'
      }),
    }
    const registry = { llm: () => llm } as unknown as ProviderRegistry
    const retrieval = {
      search: vi.fn().mockResolvedValue([ragHit]),
    } as unknown as RetrievalService
    const db = {
      documents: () => ({
        listPinned: vi.fn().mockResolvedValue([{ id: 1, title: 'Pinned Doc' }]),
        listChunksForDocument: vi.fn().mockResolvedValue([pinnedChunk]),
      }),
    } as unknown as Database

    const qa = new QAService(db, retrieval, registry)
    const events: StreamEvent[] = []
    for await (const ev of qa.answer(1, 'how?', { topK: 1 })) {
      events.push(ev)
    }

    // RAG hits stay positional; pinned hits ride opts so the prompt builder
    // can place them in the leading (KV-cached) section.
    expect(capturedHits?.map((h) => h.chunk_id)).toEqual([21])
    expect(capturedOpts?.pinnedHits?.map((h) => h.chunk_id)).toEqual([11])

    // Citations cover pinned + RAG, pinned first.
    const citations = events.filter((e) => e.type === 'citation')
    expect(citations.map((c) => (c as { chunk_id: number }).chunk_id)).toEqual([11, 21])
  })
})
