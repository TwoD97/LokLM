import { describe, it, expect, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import type { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import type { Database } from '@main/db/database'
import type { RetrievalHit, StreamEvent } from '@shared/documents'
import type { AskOptions } from '@main/services/llm/LlamaService'

// QAService.answer receives a server-side abortSignal (fired by chat:cancel).
// LlamaService.askWithModel is built to tear down the worker stream on that
// signal — but only if QAService actually forwards it into ask()'s opts.
// Without forwarding, cancel stops the UI stream while the worker keeps
// generating to completion (wasted compute, model stays busy).
describe('QAService.answer abort propagation', () => {
  it('forwards the abort signal to the LLM ask() call', async () => {
    const hit = {
      chunk_id: 1,
      document_id: 1,
      document_title: 'Doc',
      score: 0.5,
      text: 'ground truth',
    } as unknown as RetrievalHit

    let capturedOpts: AskOptions | undefined
    const llm = {
      setLanguage: vi.fn().mockResolvedValue(undefined),
      contextWindowTokens: () => 0,
      ask: vi.fn(async (_q: string, _h: RetrievalHit[], opts: AskOptions) => {
        capturedOpts = opts
        return 'answer'
      }),
    }
    const registry = { llm: () => llm } as unknown as ProviderRegistry
    const retrieval = {
      search: vi.fn().mockResolvedValue([hit]),
    } as unknown as RetrievalService
    const db = {} as unknown as Database

    const qa = new QAService(db, retrieval, registry)
    const controller = new AbortController()

    const events: StreamEvent[] = []
    for await (const ev of qa.answer(1, 'how?', { topK: 1 }, controller.signal)) {
      events.push(ev)
    }

    expect(capturedOpts?.abortSignal).toBe(controller.signal)
  })
})
