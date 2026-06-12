import { describe, it, expect, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
import type { LlmAskPayload } from '@main/services/workers/protocol'
import type { ModelStatus } from '@shared/documents'

// The chat system prompt ends with /no_think, but this GGUF honours the tag
// unreliably — the quiz path already enforces it via the segment budget
// (budgets.thoughtTokens = 0). Chat answers went through llm.ask WITHOUT that
// switch, so the model could spend hundreds of decode-tokens inside <think>…
// </think>. ThinkFilter hides those chunks, which means the renderer's
// "prefill" stage stays open the whole time: thinking latency was billed to
// prefill. askWithModel must request noThink so the worker applies the budget.
describe('LlamaService.askWithModel noThink', () => {
  it('passes noThink to the worker llm.ask payload', async () => {
    let statusListener: ((patch: Partial<ModelStatus>) => void) | undefined
    let captured: LlmAskPayload | undefined
    const client = {
      setStatusListener: vi.fn((_kind: string, cb: (patch: Partial<ModelStatus>) => void) => {
        statusListener = cb
      }),
      registerStream: vi.fn(() => () => undefined),
      llmAsk: vi.fn(async (p: LlmAskPayload) => {
        captured = p
        return { raw: 'answer' }
      }),
      llmAbort: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModelsWorkerClient

    const svc = new LlamaService({ client })
    statusListener!({ state: 'ready' })

    const out = await svc.ask('how?', [])
    expect(out).toBe('answer')
    expect(captured?.noThink).toBe(true)
  })
})
