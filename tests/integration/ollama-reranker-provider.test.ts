import { describe, it, expect, vi } from 'vitest'
import { OllamaRerankerProvider } from '@main/services/providers/ollama/OllamaRerankerProvider'

describe('OllamaRerankerProvider', () => {
  it('returns a score per passage by prompting the chat model', async () => {
    const calls: string[] = []
    const client = {
      postJson: vi
        .fn()
        .mockImplementation((_p: string, body: { messages: { content: string }[] }) => {
          calls.push(body.messages[body.messages.length - 1]!.content)
          return Promise.resolve({ message: { content: '0.7' } })
        }),
    }
    const p = new OllamaRerankerProvider(client as never, 'qwen3:0.6b')
    const scores = await p.rerank('query', ['a', 'b', 'c'])
    expect(scores).toEqual([0.7, 0.7, 0.7])
    expect(calls).toHaveLength(3)
  })

  it('clamps non-numeric or out-of-range responses to 0 or 1', async () => {
    const client = {
      postJson: vi
        .fn()
        .mockResolvedValueOnce({ message: { content: 'high' } })
        .mockResolvedValueOnce({ message: { content: '1.5' } })
        .mockResolvedValueOnce({ message: { content: '-0.2' } }),
    }
    const p = new OllamaRerankerProvider(client as never, 'qwen3:0.6b')
    const scores = await p.rerank('q', ['a', 'b', 'c'])
    expect(scores).toEqual([0, 1, 0])
  })
})
