import { describe, expect, it, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import type { RetrievalHit, StreamEvent } from '@shared/documents'
import type { AskOptions } from '@main/services/llm/LlamaService'
import { deferred } from './fixtures/retrievalHarness'

const evidence: RetrievalHit = {
  document_id: 1,
  chunk_id: 2,
  document_title: 'Fixture source',
  text: 'The supported date is 2031-02-17.',
  score: 1,
  ordinal: 0,
  heading_path: null,
  language: 'en',
  page_from: 1,
  page_to: 1,
}

function fixture(hits = [evidence]) {
  const order: string[] = []
  const llm = {
    contextWindowTokens: () => 8192,
    prepareContext: vi.fn(async () => {
      order.push('prepare')
      return 4096
    }),
    setLanguage: vi.fn(async () => {}),
    ask: vi.fn<(query: string, hits: RetrievalHit[], opts: AskOptions) => Promise<string>>(
      async () => 'Supported answer',
    ),
  }
  const registry = { llm: vi.fn(() => llm) }
  const db = {
    documentsFor: async () => ({
      listPinned: async () => [],
    }),
  }
  const retrieval = {
    search: vi.fn(async () => {
      order.push('retrieval')
      return hits
    }),
  }
  const qa = new QAService(db as never, retrieval as never, registry as never, {} as never)
  const collect = async (signal?: AbortSignal): Promise<StreamEvent[]> => {
    const result: StreamEvent[] = []
    for await (const event of qa.answer(
      1,
      'What date does the source state?',
      { language: 'en', routing: false },
      signal,
    ))
      result.push(event)
    return result
  }
  return { llm, order, registry, retrieval, collect }
}

describe('QA uses the answering context after retrieval residency changes', () => {
  it('loads chat after retrieval and carries the actual smaller window into generation', async () => {
    const f = fixture()
    const events = await f.collect()
    expect(f.order).toEqual(['retrieval', 'prepare'])
    expect(f.llm.prepareContext).toHaveBeenCalledOnce()
    expect(f.llm.ask).toHaveBeenCalledWith(
      expect.any(String),
      [evidence],
      expect.objectContaining({ plannedContextTokens: 4096 }),
    )
    expect(events.at(-1)).toMatchObject({ type: 'done', full_text: 'Supported answer' })
  })

  it('omits evidence that fits the stale window but cannot fit the actual allocation', async () => {
    const passages = [{ ...evidence, text: 'Verified source fact. '.repeat(500) }]
    const large = fixture(passages)
    large.llm.prepareContext.mockResolvedValue(8192)
    await large.collect()
    expect(large.llm.ask).toHaveBeenCalledOnce()
    const f = fixture(passages)
    const events = await f.collect()
    expect(f.llm.ask).not.toHaveBeenCalled()
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'refusal', reason: 'context_limit' }),
    )
    expect(events.some((event) => event.type === 'citation')).toBe(false)
  })

  it('skips chat loading entirely when retrieval and pinned evidence are empty', async () => {
    const f = fixture([])
    const events = await f.collect()
    expect(f.llm.prepareContext).not.toHaveBeenCalled()
    expect(f.llm.ask).not.toHaveBeenCalled()
    expect(events).toContainEqual(expect.objectContaining({ type: 'refusal', reason: 'no_hits' }))
  })

  it('stops before citations and inference when canceled during chat preparation', async () => {
    const f = fixture()
    const prepared = deferred<number>()
    f.llm.prepareContext.mockReturnValue(prepared.promise)
    const ctrl = new AbortController()
    const running = f.collect(ctrl.signal)
    await vi.waitFor(() => expect(f.llm.prepareContext).toHaveBeenCalledOnce())
    expect(f.llm.prepareContext).toHaveBeenCalledWith({ abortSignal: ctrl.signal })
    ctrl.abort()
    prepared.resolve(4096)
    expect(await running).toEqual([])
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('surfaces preparation failure without pretending to have started answer generation', async () => {
    const f = fixture()
    f.llm.prepareContext.mockRejectedValue(new Error('GPU allocation failed'))
    expect(await f.collect()).toEqual([{ type: 'error', message: 'GPU allocation failed' }])
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('keeps the prepared provider even if the registry switches during preparation', async () => {
    const f = fixture()
    const other = { ...f.llm, ask: vi.fn(async () => 'Different provider') }
    f.llm.prepareContext.mockImplementation(async () => {
      f.registry.llm.mockReturnValue(other)
      return 4096
    })
    await f.collect()
    expect(f.llm.ask).toHaveBeenCalledOnce()
    expect(other.ask).not.toHaveBeenCalled()
    expect(f.llm.setLanguage).toHaveBeenCalledWith('en')
  })
})
