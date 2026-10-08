import { afterEach, describe, expect, it, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import type { AskOptions } from '@main/services/llm/LlamaService'
import type { RetrievalHit, StreamEvent } from '@shared/documents'

vi.mock('@main/services/qa/evidenceAssessment', () => ({
  planEvidenceAssessment: () => ({
    prompt: 'Compare the supplied original passage',
    systemPrompt: 'Source comparison',
    jsonSchema: { type: 'object' },
    maxTokens: 128,
  }),
  parseEvidenceAssessment: () => ({ relation: 'compatible' }),
  renderUnresolvedEvidence: () => null,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const hit: RetrievalHit = {
  document_id: 1,
  chunk_id: 10,
  document_title: 'Original source',
  text: 'A factual source passage.',
  score: 1,
  ordinal: 0,
  heading_path: null,
  language: 'en',
  page_from: null,
  page_to: null,
}

type Phase = 'retrieval' | 'raw' | 'ask'
function fixture(phase: Phase) {
  vi.stubEnv('LOKLM_EVIDENCE_ASSESSMENT', phase === 'raw' ? '1' : '0')
  const started = deferred<AbortSignal>()
  const pending = deferred<void>()
  const pause = async (signal: AbortSignal): Promise<void> => {
    const abort = () => pending.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    started.resolve(signal)
    try {
      await pending.promise
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  const read = vi.fn(async () => ({ listPinned: async () => [] }))
  const search = vi.fn(
    async (_id: number, _query: string, _topK: number, options: { abortSignal: AbortSignal }) => {
      if (phase === 'retrieval') await pause(options.abortSignal)
      return [hit]
    },
  )
  const llm = {
    contextWindowTokens: () => 4096,
    prepareContext: async () => 4096,
    setLanguage: async () => {},
    generateRaw: vi.fn(async (_prompt: string, options: { abortSignal: AbortSignal }) => {
      await pause(options.abortSignal)
      return 'assessment'
    }),
    ask: vi.fn(async (_query: string, _hits: RetrievalHit[], options: AskOptions) => {
      await pause(options.abortSignal!)
      options.onChunk?.('Private late output', 1)
      return 'Private late output'
    }),
  }
  const qa = new QAService(
    { documentsFor: read } as never,
    { search } as never,
    { llm: () => llm } as never,
    {} as never,
  )
  return { qa, started, pending, read, search, llm }
}

afterEach(() => vi.unstubAllEnvs())

describe('QA iterator ownership before answer output', () => {
  it.each<Phase>(['retrieval', 'raw', 'ask'])(
    'return immediately aborts a pending %s next() without an external signal',
    async (phase) => {
      const f = fixture(phase)
      const stream = f.qa.answer(1, 'What does this source establish?', {
        language: 'en',
        routing: false,
      })
      const events: StreamEvent[] = []
      const consume = (async () => {
        for await (const event of stream) events.push(event)
      })()
      const signal = await f.started.promise
      let close: Promise<IteratorResult<StreamEvent>> | undefined
      try {
        close = stream.return!()
        // This assertion catches the old queued-return deadlock before we
        // manually resolve any fake provider operation in cleanup.
        expect(signal.aborted).toBe(true)
        await Promise.all([close, consume])
        expect(events.some((event) => ['token', 'done', 'error'].includes(event.type))).toBe(false)
        if (phase !== 'ask') expect(f.llm.ask).not.toHaveBeenCalled()
      } finally {
        f.pending.resolve()
        await Promise.allSettled([consume, ...(close ? [close] : [])])
      }
    },
  )

  it.each<Phase>(['retrieval', 'raw', 'ask'])(
    'throw immediately aborts pending %s and preserves the consumer error',
    async (phase) => {
      const f = fixture(phase)
      const stream = f.qa.answer(1, 'What does this source establish?', {
        language: 'en',
        routing: false,
      })
      const events: StreamEvent[] = []
      const consume = (async () => {
        for await (const event of stream) events.push(event)
      })()
      const signal = await f.started.promise
      const reason = new Error('Reader disconnected')
      // Observe the rejection immediately, before a different consumer next()
      // can finish; a thrown consumer error is not a model error event.
      const thrown = stream.throw!(reason).then(
        () => ({ rejected: false, error: undefined }),
        (error: unknown) => ({ rejected: true, error }),
      )
      try {
        expect(signal.aborted).toBe(true)
        expect(signal.reason).toBe(reason)
        expect(await thrown).toEqual({ rejected: true, error: reason })
        await consume
        expect(events.some((event) => ['token', 'done', 'error'].includes(event.type))).toBe(false)
      } finally {
        f.pending.resolve()
        await Promise.allSettled([consume, thrown])
      }
    },
  )

  it('return before the first next never opens the database or starts retrieval', async () => {
    const f = fixture('retrieval')
    const stream = f.qa.answer(1, 'Question', { language: 'en' })
    expect(await stream.return!()).toEqual({ done: true, value: undefined })
    expect(await stream.next()).toEqual({ done: true, value: undefined })
    expect(f.read).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })
})
