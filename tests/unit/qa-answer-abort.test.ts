import { describe, it, expect, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import type { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import type { WorkspaceDbFacade } from '@main/services/storage/WorkspaceDbFacade'
import type { SummarizationService } from '@main/services/summarize/SummarizationService'
import type { RetrievalHit, StreamEvent } from '@shared/documents'
import type { AskOptions } from '@main/services/llm/LlamaService'

// QAService.answer receives a server-side abortSignal (fired by chat:cancel).
// LlamaService.askWithModel is built to tear down the worker stream on that
// signal — but only if QAService actually forwards it into ask()'s opts.
// Without forwarding, cancel stops the UI stream while the worker keeps
// generating to completion (wasted compute, model stays busy).
describe('QAService.answer abort propagation', () => {
  it('propagates cancellation into the active LLM request', async () => {
    const hit = {
      chunk_id: 1,
      document_id: 1,
      document_title: 'Doc',
      score: 0.5,
      text: 'ground truth',
    } as unknown as RetrievalHit

    let capturedOpts: AskOptions | undefined
    const controller = new AbortController()
    const reason = new DOMException('User stopped the answer', 'AbortError')
    const llm = {
      setLanguage: vi.fn().mockResolvedValue(undefined),
      contextWindowTokens: () => 0,
      ask: vi.fn(async (_q: string, _h: RetrievalHit[], opts: AskOptions) => {
        capturedOpts = opts
        expect(opts.abortSignal?.aborted).toBe(false)
        controller.abort(reason)
        opts.abortSignal?.throwIfAborted()
        throw new Error('The generation should have been canceled')
      }),
    }
    const registry = { llm: () => llm } as unknown as ProviderRegistry
    const retrieval = {
      search: vi.fn().mockResolvedValue([hit]),
    } as unknown as RetrievalService
    // answer() fetches pinned docs up-front; no pins in this scenario.
    const db = {
      documentsFor: async () => ({ listPinned: vi.fn().mockResolvedValue([]) }),
    } as unknown as WorkspaceDbFacade
    const summarization = { summarize: vi.fn() } as unknown as SummarizationService

    const qa = new QAService(db, retrieval, registry, summarization)

    const events: StreamEvent[] = []
    for await (const ev of qa.answer(1, 'how?', { topK: 1 }, controller.signal)) {
      events.push(ev)
    }

    expect(capturedOpts?.abortSignal?.aborted).toBe(true)
    expect(capturedOpts?.abortSignal?.reason).toBe(reason)
    expect(events.some((event) => event.type === 'done' || event.type === 'error')).toBe(false)
    expect(retrieval.search).toHaveBeenCalledWith(
      1,
      expect.any(String),
      1,
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    )
    const searchSignal = vi.mocked(retrieval.search).mock.calls[0]![3]!.abortSignal
    expect(searchSignal?.aborted).toBe(true)
    expect(searchSignal?.reason).toBe(reason)
  })
})
