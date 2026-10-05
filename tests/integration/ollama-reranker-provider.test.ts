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
          return Promise.resolve({ done: true, message: { content: '0.7' } })
        }),
    }
    const p = new OllamaRerankerProvider(client as never, 'qwen3:0.6b')
    const scores = await p.rerank('query', ['a', 'b', 'c'])
    expect(scores).toEqual([0.7, 0.7, 0.7])
    expect(calls).toHaveLength(3)
  })

  it.each(['high', '1.5', '-0.2', 'Passage 42 has relevance 0.9', '0.3 or 0.8', '', 'NaN'])(
    'rejects an invalid score instead of changing retrieval ordering: %j',
    async (content) => {
      const client = { postJson: vi.fn().mockResolvedValue({ done: true, message: { content } }) }
      const provider = new OllamaRerankerProvider(client as never, 'fixture')
      await expect(provider.rerank('q', ['a', 'b'])).rejects.toThrow(/invalid score/)
      expect(client.postJson).toHaveBeenCalledOnce()
    },
  )

  it.each(['0', '1', ' 0.75\n', '.25', '7e-1'])(
    'accepts a complete bounded numeric score: %j',
    async (content) => {
      const client = { postJson: vi.fn().mockResolvedValue({ done: true, message: { content } }) }
      const provider = new OllamaRerankerProvider(client as never, 'fixture')
      await expect(provider.rerank('q', ['a'])).resolves.toEqual([Number(content)])
    },
  )

  it.each([
    { error: 'model stopped with code 1', done: true },
    { done: false, message: { content: '0.7' } },
    { message: { content: '0.7' } },
    { done: true, done_reason: 'length', message: { content: '0.7' } },
  ])('rejects incomplete or error responses: %j', async (response) => {
    const client = { postJson: vi.fn().mockResolvedValue(response) }
    const provider = new OllamaRerankerProvider(client as never, 'fixture')
    await expect(provider.rerank('q', ['a'])).rejects.toThrow(/incomplete score/)
  })

  it('does not send later passages after cancellation during the first response', async () => {
    const controller = new AbortController()
    const client = {
      postJson: vi.fn(async () => {
        controller.abort()
        return { done: true, message: { content: '0.7' } }
      }),
    }
    const provider = new OllamaRerankerProvider(client as never, 'fixture')
    await expect(
      provider.rerank('q', ['a', 'b'], { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postJson).toHaveBeenCalledExactlyOnceWith(
      '/api/chat',
      expect.any(Object),
      controller.signal,
    )
  })

  it('does not send a pre-cancelled request', async () => {
    const client = { postJson: vi.fn() }
    const provider = new OllamaRerankerProvider(client as never, 'fixture')
    await expect(
      provider.rerank('q', ['a'], { abortSignal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postJson).not.toHaveBeenCalled()
  })
})
