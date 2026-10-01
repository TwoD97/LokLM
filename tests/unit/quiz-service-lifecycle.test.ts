import { describe, expect, it, vi } from 'vitest'
import { QuizService } from '../../src/main/services/quiz/QuizService'
import { WorkspaceDbFacade } from '../../src/main/services/storage/WorkspaceDbFacade'
import type { AuthService } from '../../src/main/services/auth/AuthService'
import type { ProviderRegistry } from '../../src/main/services/providers/Registry'
import type { QuizDeck, QuizGenerationEvent } from '../../src/shared/quiz'

const response = JSON.stringify([
  {
    stem: 'Which value is documented?',
    options: ['A', 'B', 'C', 'D'],
    correct_index: 1,
    explanation: 'The source states B.',
    source_chunk_ids: [1],
  },
])

function setup() {
  const makeDb = (workspaceId: number) => {
    const deck: QuizDeck = {
      id: 1,
      workspaceId,
      name: `Deck ${workspaceId}`,
      documentIds: [1],
      questionCount: 0,
      language: 'en',
      status: 'generating',
      error: null,
      createdAt: 1,
    }
    return {
      workspaceId,
      deck,
      getDeck: vi.fn(async () => ({ ...deck })),
      getDocument: vi.fn(async () => ({ id: 1, title: `Source ${workspaceId}` })),
      listChunksForDocument: vi.fn(async () => [
        {
          id: 1,
          document_id: 1,
          ordinal: 0,
          text: `The source from workspace ${workspaceId} states B.`,
          token_count: 300,
          page_from: null,
          page_to: null,
          heading_path: null,
          language: null,
        },
      ]),
      setDeckStatus: vi.fn(
        async (_id: number, status: QuizDeck['status'], error: string | null) => {
          deck.status = status
          deck.error = error
        },
      ),
      completeGeneration: vi.fn(async () => {
        deck.status = 'ready'
      }),
      resetDeckForGeneration: vi.fn(async () => {
        deck.status = 'generating'
      }),
      createDeck: vi.fn(async (input: Partial<QuizDeck>) => ({ ...deck, ...input })),
    }
  }
  const a = makeDb(1)
  const b = makeDb(2)
  let active: typeof a | null = a
  const auth = {
    getWorkspaceStore: () => ({
      currentDb: () => active,
      openMetaDb: async (id: number) => (id === 1 ? a : b),
    }),
  } as unknown as AuthService
  const db = new WorkspaceDbFacade(auth)
  const generateRaw = vi.fn<(prompt: string) => Promise<string>>().mockResolvedValue(response)
  const registry = { llm: () => ({ generateRaw }) } as unknown as ProviderRegistry
  return {
    a,
    b,
    db,
    generateRaw,
    service: new QuizService(db, registry),
    activate: (id: 1 | 2 | null) => {
      active = id === null ? null : id === 1 ? a : b
    },
  }
}

async function collect(stream: AsyncIterable<QuizGenerationEvent>) {
  const events: QuizGenerationEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('quiz workspace and cancellation lifecycle', () => {
  it('pins generation source titles, chunks and final publication despite workspace switches', async () => {
    const s = setup()
    s.a.getDeck.mockImplementationOnce(async () => {
      s.activate(2)
      return { ...s.a.deck }
    })
    s.a.getDocument.mockImplementationOnce(async () => {
      s.activate(2)
      return { id: 1, title: 'Original source' }
    })
    const events = await collect(s.service.generate(1))
    expect(events.at(-1)).toEqual({ type: 'done', deckId: 1 })
    expect(s.generateRaw.mock.calls[0]?.[0]).toContain('Original source')
    expect(s.generateRaw.mock.calls[0]?.[0]).toContain('workspace 1')
    expect(s.a.completeGeneration).toHaveBeenCalledOnce()
    expect(s.b.getDocument).not.toHaveBeenCalled()
    expect(s.b.completeGeneration).not.toHaveBeenCalled()
  })

  it('resolves automatic language from the explicitly requested workspace', async () => {
    const s = setup()
    s.activate(2)
    s.a.getDocument.mockResolvedValueOnce({ id: 1, title: 'Die Übersicht für das Seminar' })
    const deck = await s.service.createDeckRow({
      workspaceId: 1,
      documentIds: [1],
      name: 'Quiz',
      language: 'auto',
    })
    expect(deck.language).toBe('de')
    expect(s.a.createDeck).toHaveBeenCalledOnce()
    expect(s.b.getDocument).not.toHaveBeenCalled()
  })

  it('keeps estimate title and chunks in the same workspace', async () => {
    const s = setup()
    s.a.getDocument.mockImplementationOnce(async () => {
      s.activate(2)
      return { id: 1, title: 'Original' }
    })
    expect((await s.service.estimate([1])).unitCount).toBe(1)
    expect(s.a.listChunksForDocument).toHaveBeenCalledOnce()
    expect(s.b.listChunksForDocument).not.toHaveBeenCalled()
  })

  it('stops creation when the session is cancelled during language reads', async () => {
    const s = setup()
    const controller = new AbortController()
    s.a.getDocument.mockImplementationOnce(async () => {
      controller.abort()
      return { id: 1, title: 'Old session document' }
    })
    await expect(
      s.service.createDeckRow(
        { workspaceId: 1, documentIds: [1], name: 'Quiz', language: 'auto' },
        controller.signal,
      ),
    ).rejects.toThrow('cancelled')
    expect(s.a.createDeck).not.toHaveBeenCalled()
    expect(s.b.createDeck).not.toHaveBeenCalled()
    expect(s.a.listChunksForDocument).not.toHaveBeenCalled()
  })

  it('does not call a provider when cancelled while a unit event is consumed', async () => {
    const s = setup()
    const controller = new AbortController()
    const events: QuizGenerationEvent[] = []
    for await (const event of s.service.generate(1, controller.signal)) {
      events.push(event)
      if (event.type === 'unit') controller.abort()
    }
    expect(s.generateRaw).not.toHaveBeenCalled()
    expect(s.a.completeGeneration).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ type: 'error', message: 'cancelled' })
    expect(s.a.deck.error).toBe('cancelled')
  })

  it('discards a late native result after cancellation without publishing progress/questions', async () => {
    const s = setup()
    const controller = new AbortController()
    s.generateRaw.mockImplementationOnce(async () => {
      controller.abort()
      return response
    })
    const events = await collect(s.service.generate(1, controller.signal))
    expect(events.some((e) => e.type === 'question' || e.type === 'done')).toBe(false)
    expect(s.a.completeGeneration).not.toHaveBeenCalled()
    expect(s.a.deck.error).toBe('cancelled')
  })

  it('checks cancellation again after the last question event before persistence', async () => {
    const s = setup()
    const controller = new AbortController()
    for await (const event of s.service.generate(1, controller.signal)) {
      if (event.type === 'question') controller.abort()
    }
    expect(s.a.completeGeneration).not.toHaveBeenCalled()
    expect(s.a.deck.error).toBe('cancelled')
  })

  it('marks an early iterator return cancelled and releases the generation reservation', async () => {
    const s = setup()
    for await (const event of s.service.generate(1)) {
      expect(event.type).toBe('plan')
      break
    }
    expect(s.a.deck.status).toBe('failed')
    expect(s.a.deck.error).toBe('cancelled')
    expect(s.generateRaw).not.toHaveBeenCalled()
    await s.service.prepareRegeneration(1)
    expect(s.a.resetDeckForGeneration).toHaveBeenCalledOnce()
    expect((await collect(s.service.generate(1))).at(-1)).toEqual({ type: 'done', deckId: 1 })
  })

  it('rejects a simultaneous generator or regeneration without failing the original deck', async () => {
    const s = setup()
    const stream = s.service.generate(1)[Symbol.asyncIterator]()
    await stream.next()
    expect(await collect(s.service.generate(1))).toEqual([
      { type: 'error', message: 'Quiz generation is already running' },
    ])
    await expect(s.service.prepareRegeneration(1)).rejects.toThrow('already running')
    expect(s.a.setDeckStatus).not.toHaveBeenCalled()
    expect(s.a.resetDeckForGeneration).not.toHaveBeenCalled()
    await stream.return?.()
  })

  it('does not overwrite a previously completed deck if generation is requested again', async () => {
    const s = setup()
    s.a.deck.status = 'ready'
    expect(await collect(s.service.generate(1))).toEqual([
      { type: 'error', message: 'Quiz is not awaiting generation' },
    ])
    expect(s.a.setDeckStatus).not.toHaveBeenCalled()
    expect(s.generateRaw).not.toHaveBeenCalled()
  })
})
