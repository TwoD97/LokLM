import { describe, expect, it, vi } from 'vitest'
import { runChatTurn, persistChatTurn } from '../../src/main/services/qa/chatTurn'
import type { StreamEvent } from '../../src/shared/documents'

const source = { doc_id: 1, chunk_id: 2, score: 0.8 }
const other = { doc_id: 3, chunk_id: 4, score: 0.5 }
async function* events(...items: StreamEvent[]): AsyncGenerator<StreamEvent> {
  yield* items
}
const terminalEvents = (items: StreamEvent[]): StreamEvent[] =>
  items.filter((event) => event.type === 'done' || event.type === 'error')

describe('chat turn finalization', () => {
  it('uses final text and citation membership, and emits one terminal only after saving', async () => {
    const emitted: StreamEvent[] = []
    const persist = vi.fn(async (turn) => {
      expect(terminalEvents(emitted)).toEqual([])
      expect(turn.content).toBe('Final [doc:3, chunk:4]')
      expect(turn.citations).toEqual([other])
    })
    const turn = await runChatTurn({
      stream: () =>
        events(
          { type: 'citation', ...source },
          { type: 'token', text: 'Draft [doc:1, chunk:2]' },
          { type: 'done', full_text: 'Final [doc:3, chunk:4]', citations: [other] },
        ),
      signal: new AbortController().signal,
      language: 'en',
      emit: (event) => emitted.push(event),
      persist,
    })
    expect(persist).toHaveBeenCalledOnce()
    expect(turn.outcome).toBe('completed')
    expect(terminalEvents(emitted)).toEqual([
      { type: 'done', full_text: turn.content, citations: [other], outcome: 'completed' },
    ])
  })

  it('persists final-only answers without requiring token events', async () => {
    const persist = vi.fn()
    const turn = await runChatTurn({
      stream: () => events({ type: 'done', full_text: 'Final-only answer', citations: [source] }),
      signal: new AbortController().signal,
      language: 'en',
      emit: vi.fn(),
      persist,
    })
    expect(turn.content).toBe('Final-only answer')
    expect(turn.metrics).toEqual({ ttftMs: null, tokensPerSec: null, tokenCount: 0 })
    expect(persist).toHaveBeenCalledOnce()
  })

  it('never replaces unknown citation attempts with all provided sources', async () => {
    const turn = await runChatTurn({
      stream: () =>
        events({ type: 'done', full_text: 'Claim [doc:99, chunk:99]', citations: [source] }),
      signal: new AbortController().signal,
      language: 'en',
      emit: vi.fn(),
    })
    expect(turn.citations).toEqual([])
    expect(turn.content).toContain('[doc:99, chunk:99]')
  })

  it('rejects an empty completion without erasing streamed partial text', async () => {
    const turn = await runChatTurn({
      stream: () =>
        events(
          { type: 'token', text: 'Partial' },
          { type: 'done', full_text: '  ', citations: [] },
        ),
      signal: new AbortController().signal,
      language: 'en',
      emit: vi.fn(),
    })
    expect(turn.outcome).toBe('failed')
    expect(turn.content).toBe('Partial\n\n_[The answer could not be completed.]_')
  })

  it('reports generator cleanup errors after a yielded completion', async () => {
    async function* stream(): AsyncGenerator<StreamEvent> {
      try {
        yield { type: 'done', full_text: 'Final', citations: [] }
      } finally {
        // eslint-disable-next-line no-unsafe-finally -- This regression fixture intentionally fails generator cleanup.
        throw new Error('Cleanup failed')
      }
    }
    const turn = await runChatTurn({
      stream,
      signal: new AbortController().signal,
      language: 'en',
      emit: vi.fn(),
    })
    expect(turn.outcome).toBe('failed')
    expect(turn.error).toBe('Cleanup failed')
    expect(turn.content).toBe('Final\n\n_[The answer could not be completed.]_')
  })

  it.each(['event', 'throw', 'missing'] as const)(
    'preserves failed partial answers for %s failures without a success terminal',
    async (kind) => {
      const emitted: StreamEvent[] = []
      async function* stream(): AsyncGenerator<StreamEvent> {
        yield { type: 'citation', ...source }
        yield { type: 'token', text: 'Partial [doc:1, chunk:2]' }
        if (kind === 'event') yield { type: 'error', message: 'Inference failed' }
        if (kind === 'throw') throw new Error('Inference failed')
      }
      const persist = vi.fn()
      const turn = await runChatTurn({
        stream,
        signal: new AbortController().signal,
        language: 'en',
        emit: (event) => emitted.push(event),
        persist,
      })
      expect(turn.outcome).toBe('failed')
      expect(turn.content).toBe(
        'Partial [doc:1, chunk:2]\n\n_[The answer could not be completed.]_',
      )
      expect(turn.citations).toEqual([source])
      expect(persist).toHaveBeenCalledWith(turn)
      expect(terminalEvents(emitted)).toEqual([
        {
          type: 'error',
          message: turn.error,
          full_text: turn.content,
          citations: [source],
          persisted: true,
        },
      ])
    },
  )

  it('does not start inference after preflight cancellation and persists an interruption', async () => {
    const controller = new AbortController()
    controller.abort()
    const stream = vi.fn(() => events())
    const emitted: StreamEvent[] = []
    const turn = await runChatTurn({
      stream,
      signal: controller.signal,
      language: 'de',
      emit: (event) => emitted.push(event),
    })
    expect(stream).not.toHaveBeenCalled()
    expect(turn.content).toBe('_[Antwort wurde unterbrochen.]_')
    expect(terminalEvents(emitted)).toEqual([
      { type: 'done', full_text: turn.content, citations: [], outcome: 'cancelled' },
    ])
  })

  it('retains the current token on disconnect/cancel and rejects later generator output', async () => {
    const controller = new AbortController()
    const emitted: StreamEvent[] = []
    const turn = await runChatTurn({
      stream: () =>
        events(
          { type: 'stage', stage: 'prefill', status: 'start' },
          { type: 'token', text: 'Partial' },
          { type: 'done', full_text: 'Must not become final', citations: [] },
        ),
      signal: controller.signal,
      language: 'en',
      emit: (event) => {
        emitted.push(event)
        if (event.type === 'token') controller.abort()
      },
    })
    expect(turn.outcome).toBe('cancelled')
    expect(turn.content).toBe('Partial\n\n_[Answer interrupted.]_')
    expect(turn.pipeline).toEqual([{ stage: 'prefill', status: 'running' }])
    expect(terminalEvents(emitted)).toHaveLength(1)
  })

  it('surfaces failed persistence without a false successful terminal', async () => {
    const emitted: StreamEvent[] = []
    const turn = await runChatTurn({
      stream: () => events({ type: 'done', full_text: 'Answer', citations: [] }),
      signal: new AbortController().signal,
      language: 'en',
      emit: (event) => emitted.push(event),
      persist: async () => {
        throw new Error('Disk unavailable')
      },
    })
    expect(turn.outcome).toBe('failed')
    expect(turn.content).toContain('This answer could not be saved.')
    expect(terminalEvents(emitted)).toEqual([
      {
        type: 'error',
        message: 'This answer could not be saved. Disk unavailable',
        full_text: turn.content,
        citations: [],
        persisted: false,
      },
    ])
  })

  it('rolls back an assistant row when its citations cannot be persisted', async () => {
    const store = {
      appendMessage: vi.fn(async () => ({ id: 17 })),
      persistCitations: vi.fn(async () => {
        throw new Error('Missing source')
      }),
      deleteMessage: vi.fn(async () => {}),
    }
    const turn = await runChatTurn({
      stream: () =>
        events({ type: 'done', full_text: 'Answer [doc:1, chunk:2]', citations: [source] }),
      signal: new AbortController().signal,
      language: 'en',
      emit: vi.fn(),
    })
    await expect(persistChatTurn(store, 2, turn)).rejects.toThrow('Missing source')
    expect(store.deleteMessage).toHaveBeenCalledWith(17)
  })

  it('retains an unsaved failure payload when both citation saving and rollback fail', async () => {
    const store = {
      appendMessage: vi.fn(async () => ({ id: 17 })),
      persistCitations: vi.fn(async () => {
        throw new Error('Sources failed')
      }),
      deleteMessage: vi.fn(async () => {
        throw new Error('Rollback failed')
      }),
    }
    const emitted: StreamEvent[] = []
    const turn = await runChatTurn({
      stream: () =>
        events({ type: 'done', full_text: 'Answer [doc:1, chunk:2]', citations: [source] }),
      signal: new AbortController().signal,
      language: 'en',
      emit: (event) => emitted.push(event),
      persist: (result) => persistChatTurn(store, 2, result),
    })
    expect(turn.outcome).toBe('failed')
    expect(turn.content).toContain('Answer [doc:1, chunk:2]')
    expect(turn.content).toContain('This answer could not be saved.')
    expect(terminalEvents(emitted)).toEqual([
      {
        type: 'error',
        message: turn.error,
        full_text: turn.content,
        citations: [source],
        persisted: false,
      },
    ])
  })
})
