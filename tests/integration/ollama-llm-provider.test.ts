import { describe, it, expect, vi } from 'vitest'
import { OllamaLlmProvider } from '@main/services/providers/ollama/OllamaLlmProvider'

function mkClient(stream: object[]): { postNdjson: ReturnType<typeof vi.fn> } {
  return {
    postNdjson: vi.fn().mockImplementation(async function* () {
      for (const ev of stream) yield ev
    }),
  } as never
}

describe('OllamaLlmProvider', () => {
  it('forwards the QA output reserve instead of relying on server defaults', async () => {
    const client = mkClient([{ done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await provider.ask('Question', [], { maxTokens: 512 })
    expect(client.postNdjson).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        options: { num_predict: 512, num_ctx: provider.contextWindowTokens() },
      }),
      undefined,
    )
  })

  it('does not send a chat request that was already cancelled', async () => {
    const client = mkClient([{ done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const controller = new AbortController()
    controller.abort()
    await expect(provider.ask('Question', [], { abortSignal: controller.signal })).rejects.toThrow()
    expect(client.postNdjson).not.toHaveBeenCalled()
  })

  it('rejects truncated translation output', async () => {
    const client = mkClient([{ response: 'unfinished', done: true, done_reason: 'length' }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await expect(provider.generateRaw('Hello', { requireComplete: true })).rejects.toThrow(
      'output limit',
    )
  })
  it('forwards translation instructions, temperature and cancellation to raw generation', async () => {
    const client = mkClient([{ response: 'Hallo', done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const controller = new AbortController()
    expect(
      await provider.generateRaw('Hello', {
        systemPrompt: 'Translate faithfully',
        temperature: 0,
        maxTokens: 100,
        abortSignal: controller.signal,
      }),
    ).toBe('Hallo')
    expect(client.postNdjson).toHaveBeenCalledWith(
      '/api/generate',
      expect.objectContaining({
        system: 'Translate faithfully',
        options: { temperature: 0, num_predict: 100, num_ctx: provider.contextWindowTokens() },
      }),
      controller.signal,
    )
  })
  it('accumulates streamed text from /api/chat', async () => {
    const client = mkClient([
      { message: { content: 'hello ' } },
      { message: { content: 'world' } },
      { done: true },
    ])
    const p = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const out = await p.ask('q', [], {})
    expect(out).toBe('hello world')
  })

  it('forwards token chunks via onChunk', async () => {
    const client = mkClient([
      { message: { content: 'a' } },
      { message: { content: 'b' } },
      { done: true },
    ])
    const chunks: string[] = []
    const p = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await p.ask('q', [], { onChunk: (c) => chunks.push(c) })
    expect(chunks.join('')).toBe('ab')
  })
})
