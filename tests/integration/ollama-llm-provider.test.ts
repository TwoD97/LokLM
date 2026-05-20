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
