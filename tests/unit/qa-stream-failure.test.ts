import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import { runChatTurn } from '@main/services/qa/chatTurn'
import type { AskOptions } from '@main/services/llm/LlamaService'
import type { RetrievalHit, StreamEvent } from '@shared/documents'

const hit: RetrievalHit = {
  document_id: 1,
  chunk_id: 10,
  document_title: 'Source',
  text: 'A supplied factual passage.',
  score: 1,
  ordinal: 0,
  heading_path: null,
  language: 'en',
  page_from: null,
  page_to: null,
}

function streamWith(ask: (options: AskOptions) => Promise<string>, signal: AbortSignal) {
  const qa = new QAService(
    { documentsFor: async () => ({ listPinned: async () => [] }) } as never,
    { search: async () => [hit] } as never,
    {
      llm: () => ({
        contextWindowTokens: () => 4096,
        prepareContext: async () => 4096,
        setLanguage: async () => {},
        ask: (_question: string, _hits: RetrievalHit[], options: AskOptions) => ask(options),
      }),
    } as never,
    {} as never,
  )
  return qa.answer(1, 'What does the passage say?', { language: 'en', routing: false }, signal)
}

beforeEach(() => vi.stubEnv('LOKLM_EVIDENCE_ASSESSMENT', '0'))
afterEach(() => vi.unstubAllEnvs())

describe('QA failure queue and durable partial answers', () => {
  it('preserves a tail received between queue drains, with exactly one failed terminal', async () => {
    const controller = new AbortController()
    const events: StreamEvent[] = []
    const persist = vi.fn(async () => {})
    const result = await runChatTurn({
      signal: controller.signal,
      language: 'en',
      emit: (event) => events.push(event),
      persist,
      stream: () =>
        streamWith(async (options) => {
          // Yield once: QA has already checked its initially empty queue.
          await Promise.resolve()
          options.onChunk?.('Partial [doc:1, chunk:10]', 2)
          options.onChunk?.(' tail', 3)
          throw new Error('Provider stream ended early')
        }, controller.signal),
    })
    expect(result.outcome).toBe('failed')
    expect(result.content).toBe(
      'Partial [doc:1, chunk:10] tail\n\n_[The answer could not be completed.]_',
    )
    expect(result.metrics.tokenCount).toBe(5)
    expect(result.citations).toEqual([{ doc_id: 1, chunk_id: 10, score: 1 }])
    expect(persist).toHaveBeenCalledOnce()
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.some((event) => event.type === 'done')).toBe(false)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'stage',
        stage: 'prefill',
        status: 'done',
      }),
    )
  })

  it('discards queued private text when cancellation wins the failed request', async () => {
    const controller = new AbortController()
    const events: StreamEvent[] = []
    for await (const event of streamWith(async (options) => {
      await Promise.resolve()
      options.onChunk?.('Private pending text', 1)
      controller.abort()
      throw new Error('Stopped')
    }, controller.signal))
      events.push(event)
    expect(events.some((event) => ['token', 'error', 'done'].includes(event.type))).toBe(false)
  })

  it('checks cancellation again between yielded tail chunks', async () => {
    const controller = new AbortController()
    const events: StreamEvent[] = []
    for await (const event of streamWith(async (options) => {
      await Promise.resolve()
      options.onChunk?.('Already visible', 1)
      options.onChunk?.('Must stay private', 1)
      throw new Error('Interrupted')
    }, controller.signal)) {
      events.push(event)
      if (event.type === 'token') controller.abort()
    }
    expect(events.filter((event) => event.type === 'token')).toEqual([
      { type: 'token', text: 'Already visible', count: 1 },
    ])
    expect(events.some((event) => event.type === 'error' || event.type === 'done')).toBe(false)
  })

  it('does not invent text or a completed prefill for a failure without output', async () => {
    const controller = new AbortController()
    const events: StreamEvent[] = []
    for await (const event of streamWith(async () => {
      await Promise.resolve()
      throw new Error('Unavailable')
    }, controller.signal))
      events.push(event)
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: 'Unavailable' },
    ])
    expect(events.some((event) => event.type === 'token' || event.type === 'done')).toBe(false)
    expect(
      events.some(
        (event) => event.type === 'stage' && event.stage === 'prefill' && event.status === 'done',
      ),
    ).toBe(false)
  })
})
