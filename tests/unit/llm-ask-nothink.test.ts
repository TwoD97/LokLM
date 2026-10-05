import { describe, it, expect, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
import type { LlmAskPayload } from '@main/services/workers/protocol'
import type { ModelStatus } from '@shared/documents'
import type { RetrievalHit } from '@shared/documents'

// Build a ready LlamaService whose worker returns a fixed `raw` string from
// llm.ask, with a no-op stream (the mock never feeds chunks, so `accumulated`
// stays empty — exactly the case where the renderer received nothing).
function makeService(raw: string): {
  svc: LlamaService
  captured: () => LlmAskPayload | undefined
} {
  let statusListener: ((patch: Partial<ModelStatus>) => void) | undefined
  let captured: LlmAskPayload | undefined
  const client = {
    setStatusListener: vi.fn((_kind: string, cb: (patch: Partial<ModelStatus>) => void) => {
      statusListener = cb
    }),
    registerStream: vi.fn(() => () => undefined),
    llmAsk: vi.fn(async (p: LlmAskPayload) => {
      captured = p
      return { raw }
    }),
    llmAbort: vi.fn().mockResolvedValue(undefined),
  } as unknown as ModelsWorkerClient
  const svc = new LlamaService({ client })
  statusListener!({ state: 'ready' })
  return { svc, captured: () => captured }
}

function hit(text: string): RetrievalHit {
  return {
    chunk_id: 1,
    document_id: 2,
    document_title: 'Skript',
    ordinal: 0,
    page_from: null,
    page_to: null,
    heading_path: null,
    text,
    score: 0.9,
    language: 'de',
  }
}

describe('LlamaService.askWithModel noThink', () => {
  it('uses the output limit reserved by the QA planner', async () => {
    const { svc, captured } = makeService('answer')
    await svc.ask('how?', [], { maxTokens: 512 })
    expect(captured()?.maxTokens).toBe(512)
  })

  it('bounds an excessive caller limit to the resolved window allowance', async () => {
    const { svc, captured } = makeService('answer')
    await svc.ask('how?', [], { maxTokens: 100_000 })
    expect(captured()?.maxTokens).toBe(2048)
  })

  it('does not start generation when cancellation has already arrived', async () => {
    const { svc, captured } = makeService('answer')
    const controller = new AbortController()
    controller.abort()
    await expect(svc.ask('how?', [], { abortSignal: controller.signal })).rejects.toThrow()
    expect(captured()).toBeUndefined()
  })

  it('passes noThink to the worker llm.ask payload', async () => {
    const { svc, captured } = makeService('answer')
    const out = await svc.ask('how?', [])
    expect(out).toBe('answer')
    expect(captured()?.noThink).toBe(true)
  })
})

describe('LlamaService overflow retry output integrity', () => {
  function streamingFixture(firstOutput: string) {
    let statusListener!: (patch: Partial<ModelStatus>) => void
    let onToken!: (text: string, count: number) => void
    const ask = vi
      .fn()
      .mockImplementationOnce(async () => {
        if (firstOutput) onToken(firstOutput, 1)
        throw new Error('Failed to free up space for new tokens')
      })
      .mockImplementationOnce(async () => {
        onToken('Replacement answer.', 1)
        return { raw: 'Replacement answer.' }
      })
    const client = {
      setStatusListener: (_kind: string, listener: typeof statusListener) => {
        statusListener = listener
      },
      registerStream: (_id: string, listener: typeof onToken) => {
        onToken = listener
        return () => undefined
      },
      llmAsk: ask,
      llmAbort: vi.fn(async () => undefined),
    } as unknown as ModelsWorkerClient
    const service = new LlamaService({ client })
    statusListener({ state: 'ready' })
    return { service, ask }
  }

  it('does not append a second answer after an overflow follows visible tokens', async () => {
    const { service, ask } = streamingFixture('Partial first answer.')
    const output: string[] = []
    await expect(
      service.ask('Question', [], {
        conversationHistory: [{ role: 'user', content: 'Prior conversation detail' }],
        onChunk: (text) => output.push(text),
      }),
    ).rejects.toThrow(/free up space/)
    expect(ask).toHaveBeenCalledOnce()
    // The legacy think filter may hold a short suffix until successful EOF.
    // Preserve the already-visible prefix and never append the retry's answer.
    expect(output.join('')).toMatch(/^Partial first/)
    expect('Partial first answer.'.startsWith(output.join(''))).toBe(true)
    expect(output.join('')).not.toContain('Replacement')
  })

  it('still retries without history when overflow happens before any answer', async () => {
    const { service, ask } = streamingFixture('')
    const output: string[] = []
    await expect(
      service.ask('Question', [], {
        conversationHistory: [{ role: 'user', content: 'Prior conversation detail' }],
        onChunk: (text) => output.push(text),
      }),
    ).resolves.toBe('Replacement answer.')
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[0]![0].prompt).toContain('Prior conversation detail')
    expect(ask.mock.calls[1]![0].prompt).not.toContain('Prior conversation detail')
    expect(output.join('')).toBe('Replacement answer.')
  })
})

// Recovery (ADR-0008 follow-up / 0.6.2): the lite 2B GGUF sometimes ignores
// /no_think and emits a pure or UNCLOSED <think> block. The streaming ThinkFilter
// swallows every chunk (renderer sees nothing) and stripThink — which only
// matches CLOSED <think>…</think> — returns '' or the literal tag. Left alone
// that is an invisible blank answer. askWithModel must recover into a non-blank
// turn and re-emit it so it both renders and persists.
describe('LlamaService.askWithModel empty/think-only recovery', () => {
  it('recovers an UNCLOSED <think> block into its content (not a blank, no tag)', async () => {
    const chunks: string[] = []
    const { svc } = makeService('<think>Ein Interpreter führt Befehle direkt aus')
    const out = await svc.ask('Was ist ein Interpreter?', [], { onChunk: (t) => chunks.push(t) })
    expect(out).toBe('Ein Interpreter führt Befehle direkt aus')
    expect(out).not.toContain('<think')
    // nothing streamed during generation → the recovered text is re-emitted so
    // the renderer shows it AND the main process persists it (it only persists
    // when at least one token streamed).
    expect(chunks.join('')).toContain('Ein Interpreter führt Befehle direkt aus')
  })

  it('falls back to the retrieved Context when the model emits only a closed think block', async () => {
    const { svc } = makeService('<think>just reasoning, no answer</think>')
    const out = await svc.ask('Was ist ein Interpreter?', [
      hit('Interpreter sind langsamer als Compiler.'),
    ])
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('Interpreter sind langsamer als Compiler.')
  })

  it('still returns a normal answer unchanged (no recovery when output is clean)', async () => {
    const { svc } = makeService('<think>reason</think>Ein Interpreter ist ein Programm.')
    const out = await svc.ask('Was ist ein Interpreter?', [])
    expect(out).toBe('Ein Interpreter ist ein Programm.')
  })
})
