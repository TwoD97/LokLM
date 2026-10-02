import { describe, expect, it, vi } from 'vitest'
import { OllamaLlmProvider } from '@main/services/providers/ollama/OllamaLlmProvider'
import { OllamaError } from '@main/services/providers/ollama/OllamaClient'
import { ProviderRegistry } from '@main/services/providers/Registry'
import { runChatTurn } from '@main/services/qa/chatTurn'
import type { AskOptions } from '@main/services/llm/LlamaService'
import type { StreamEvent } from '@shared/documents'

type Failure = 'eof' | 'error-record' | 'network'

function fixture(failure: Failure, partial: boolean) {
  const client = {
    postNdjson: vi.fn().mockImplementation(async function* () {
      if (partial) yield { message: { content: 'Remote partial answer.' } }
      if (failure === 'error-record') yield { error: 'Remote backend stopped', done: true }
      if (failure === 'network') throw new OllamaError('network', 'Connection reset')
    }),
  }
  const bundledAsk = vi.fn(async (_question: string, _hits: unknown[], opts: AskOptions) => {
    opts.onChunk?.('Bundled answer.', 1)
    return 'Bundled answer.'
  })
  const fallback = vi.fn()
  const registry = new ProviderRegistry({
    llm: {
      bundled: { ask: bundledAsk } as never,
      ollama: new OllamaLlmProvider(client as never, 'test-model'),
    },
    embedder: { bundled: {} as never, ollama: null },
    reranker: { bundled: {} as never, ollama: null },
    onFallback: fallback,
  })
  registry.setLlmSource('ollama')
  return { registry, client, bundledAsk, fallback }
}

describe('Ollama chat completion and provider fallback', () => {
  it.each<Failure>(['eof', 'error-record', 'network'])(
    'allows fallback for %s before any answer text',
    async (failure) => {
      const { registry, client, bundledAsk, fallback } = fixture(failure, false)
      const chunks: string[] = []
      expect(
        await registry.llm().ask('Question', [], { onChunk: (text) => chunks.push(text) }),
      ).toBe('Bundled answer.')
      expect(chunks).toEqual(['Bundled answer.'])
      expect(bundledAsk).toHaveBeenCalledOnce()
      expect(fallback).toHaveBeenCalledOnce()
      expect(client.postNdjson).toHaveBeenCalledOnce()
    },
  )

  it.each<Failure>(['eof', 'error-record', 'network'])(
    'persists a marked partial turn for %s without starting the bundled model',
    async (failure) => {
      const { registry, client, bundledAsk, fallback } = fixture(failure, true)
      const events: StreamEvent[] = []
      const persist = vi.fn()
      const turn = await runChatTurn({
        signal: new AbortController().signal,
        language: 'en',
        emit: (event) => events.push(event),
        persist,
        stream: async function* (): AsyncGenerator<StreamEvent> {
          const streamed: StreamEvent[] = []
          let answer: string | undefined
          let error: unknown
          try {
            answer = await registry.llm().ask('Question', [], {
              onChunk: (text, count) => streamed.push({ type: 'token', text, count }),
            })
          } catch (caught) {
            error = caught
          }
          yield* streamed
          if (error) throw error
          yield { type: 'done', full_text: answer!, citations: [] }
        },
      })
      expect(turn.outcome).toBe('failed')
      expect(turn.content).toBe('Remote partial answer.\n\n_[The answer could not be completed.]_')
      expect(persist).toHaveBeenCalledExactlyOnceWith(turn)
      expect(events.at(-1)).toMatchObject({ type: 'error', persisted: true })
      expect(events.some((event) => event.type === 'done')).toBe(false)
      expect(bundledAsk).not.toHaveBeenCalled()
      expect(fallback).not.toHaveBeenCalled()
      expect(client.postNdjson).toHaveBeenCalledOnce()
    },
  )

  it.each([400, 422])('does not retry chat HTTP %i configuration failures', async (status) => {
    const { registry, client, bundledAsk, fallback } = fixture('eof', false)
    const error = new OllamaError('client', `HTTP ${status}`, status)
    client.postNdjson.mockImplementation(async function* () {
      yield await Promise.reject(error)
    })
    await expect(registry.llm().ask('Question', [], {})).rejects.toBe(error)
    expect(client.postNdjson).toHaveBeenCalledOnce()
    expect(bundledAsk).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rejects cancellation at the final event without forwarding its text or falling back', async () => {
    const { registry, client, bundledAsk, fallback } = fixture('eof', false)
    const controller = new AbortController()
    client.postNdjson.mockImplementation(async function* () {
      yield { message: { content: 'Accepted text.' } }
      controller.abort()
      yield { message: { content: ' Late text.' }, done: true }
    })
    const chunks: string[] = []
    await expect(
      registry.llm().ask('Question', [], {
        abortSignal: controller.signal,
        onChunk: (text) => chunks.push(text),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(chunks.join('')).toBe('Accepted text.')
    expect(bundledAsk).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })
})
