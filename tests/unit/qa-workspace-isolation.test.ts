import { describe, expect, it, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import { SummarizationService } from '@main/services/summarize/SummarizationService'
import { deferred } from './fixtures/retrievalHarness'

vi.mock('@main/services/documents/languageDetector', () => ({
  detectResponseLanguage: async () => 'en',
}))

function fixture() {
  const makeRepo = (workspaceId: number, text: string) => ({
    getDocument: vi.fn(async () => ({
      id: 1,
      workspaceId,
      title: `Library ${workspaceId}`,
      summary: null as string | null,
      status: 'ready',
      contentHash: 'fixture-hash',
    })),
    listPinned: vi.fn(async () => [{ id: 1, title: `Library ${workspaceId}` }]),
    listChunksForDocument: vi.fn(async () => [
      {
        id: 1,
        document_id: 1,
        ordinal: 0,
        text,
        token_count: 10,
        page_from: 1,
        page_to: 1,
        heading_path: null,
        language: 'en',
      },
    ]),
    setSummary: vi.fn(async () => true),
    setSummaryEmbedding: vi.fn(async () => {}),
    hasSummaryEmbeddings: vi.fn(async () => true),
    searchDocumentsByTheme: vi.fn(async () => []),
  })
  const original = makeRepo(3, 'Original library evidence')
  const other = makeRepo(8, 'Unrelated private library evidence')
  let active = original
  const db = {
    documents: () => active,
    documentsFor: vi.fn(async (workspaceId: number) => (workspaceId === 3 ? original : other)),
  }
  const llm = {
    setLanguage: vi.fn(async () => {}),
    contextWindowTokens: () => 4096,
    isReady: () => true,
    ask: vi.fn(async () => 'Supported answer'),
    generateRaw: vi.fn(async () => 'Supported summary'),
  }
  const embedder = {
    isReady: vi.fn(() => false),
    identity: () => 'fixture',
    embed: vi.fn(async () => [new Float32Array([1, 0])]),
  }
  const registry = { llm: () => llm, embedder: () => embedder }
  const summarize = new SummarizationService(db as never, registry as never)
  return {
    original,
    other,
    db,
    llm,
    embedder,
    registry,
    summarize,
    switchWorkspace: () => {
      active = other
    },
  }
}

describe('workspace ownership across RAG and summary awaits', () => {
  it('keeps pinned evidence in the answering workspace after a library switch during retrieval', async () => {
    const f = fixture()
    const search = vi.fn(async () => {
      f.switchWorkspace()
      return []
    })
    const qa = new QAService(f.db as never, { search } as never, f.registry as never, f.summarize)
    const events = []
    for await (const event of qa.answer(3, 'What is supported?', {
      routing: false,
      language: 'en',
    })) {
      events.push(event)
    }
    expect(f.db.documentsFor).toHaveBeenCalledWith(3)
    expect(f.original.listChunksForDocument).toHaveBeenCalledWith(1)
    expect(f.other.listChunksForDocument).not.toHaveBeenCalled()
    expect(f.llm.ask).toHaveBeenCalledWith(
      'What is supported?',
      [],
      expect.objectContaining({
        pinnedHits: [expect.objectContaining({ text: 'Original library evidence' })],
      }),
    )
    expect(events.at(-1)).toMatchObject({ type: 'done', full_text: 'Supported answer' })
  })

  it('writes a generated summary only to its original workspace after a library switch', async () => {
    const f = fixture()
    const model = deferred<string>()
    f.llm.generateRaw.mockReturnValue(model.promise)
    const running = f.summarize.summarize(1)
    await vi.waitFor(() => expect(f.llm.generateRaw).toHaveBeenCalledOnce())
    f.switchWorkspace()
    model.resolve('Original source summary')
    expect(await running).toEqual({ summary: 'Original source summary', cached: false })
    expect(f.original.setSummary).toHaveBeenCalledWith(1, 'Original source summary', {
      contentHash: 'fixture-hash',
      chunkCount: 1,
      lastChunkId: 1,
    })
    expect(f.other.setSummary).not.toHaveBeenCalled()
  })

  it('uses an explicit summary workspace even when another same-id document is active', async () => {
    const f = fixture()
    f.switchWorkspace()
    await f.summarize.summarize(1, { workspaceId: 3 })
    expect(f.original.getDocument).toHaveBeenCalledWith(1)
    expect(f.other.getDocument).not.toHaveBeenCalled()
    expect(f.llm.generateRaw).toHaveBeenCalledWith(
      expect.stringContaining('Original library evidence'),
      expect.anything(),
    )
  })

  it('rejects source changes during generation without embedding or publishing stale output', async () => {
    const f = fixture()
    const model = deferred<string>()
    f.llm.generateRaw.mockReturnValue(model.promise)
    f.embedder.isReady.mockReturnValue(true)
    const running = f.summarize.summarize(1)
    const assertion = expect(running).rejects.toThrow('document changed')
    await vi.waitFor(() => expect(f.llm.generateRaw).toHaveBeenCalledOnce())
    f.original.setSummary.mockResolvedValue(false)
    model.resolve('Obsolete source summary')
    await assertion
    expect(f.embedder.embed).not.toHaveBeenCalled()
  })

  it('does not generate or return a cached summary for an unfinished document', async () => {
    const f = fixture()
    const doc = await f.original.getDocument()
    f.original.getDocument.mockResolvedValue({ ...doc, status: 'indexing', summary: 'Old summary' })
    await expect(f.summarize.summarize(1)).rejects.toMatchObject({ code: 'no_content' })
    expect(f.original.listChunksForDocument).not.toHaveBeenCalled()
    expect(f.llm.generateRaw).not.toHaveBeenCalled()
  })

  it('does not cache late model output after cancellation or start summary embedding', async () => {
    const f = fixture()
    const model = deferred<string>()
    f.llm.generateRaw.mockReturnValue(model.promise)
    const ctrl = new AbortController()
    const running = f.summarize.summarize(1, { abortSignal: ctrl.signal })
    await vi.waitFor(() => expect(f.llm.generateRaw).toHaveBeenCalledOnce())
    ctrl.abort()
    model.resolve('Output from a provider that ignored cancellation')
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.original.setSummary).not.toHaveBeenCalled()
    expect(f.embedder.embed).not.toHaveBeenCalled()
  })

  it('does not park chat merely to embed a new summary when the local embedder is not resident', async () => {
    const f = fixture()
    f.embedder.isReady.mockReturnValue(true)
    Object.assign(f.embedder, { isResident: () => false })
    await expect(f.summarize.summarize(1)).resolves.toMatchObject({ cached: false })
    expect(f.original.setSummary).toHaveBeenCalledOnce()
    expect(f.embedder.embed).not.toHaveBeenCalled()
    expect(f.original.setSummaryEmbedding).not.toHaveBeenCalled()
  })

  it.each(['resident', 'remote'] as const)(
    'still embeds summaries with an available %s provider',
    async (kind) => {
      const f = fixture()
      f.embedder.isReady.mockReturnValue(true)
      if (kind === 'resident') Object.assign(f.embedder, { isResident: () => true })
      await f.summarize.summarize(1)
      expect(f.embedder.embed).toHaveBeenCalledWith(['Supported summary'])
      expect(f.original.setSummaryEmbedding).toHaveBeenCalledWith(
        1,
        [1, 0],
        'fixture',
        'Supported summary',
      )
    },
  )

  it('does not report success when cancellation arrives during the optional summary-vector write', async () => {
    const f = fixture()
    const write = deferred<void>()
    f.original.setSummaryEmbedding.mockReturnValue(write.promise)
    f.embedder.isReady.mockReturnValue(true)
    const ctrl = new AbortController()
    const running = f.summarize.summarize(1, { abortSignal: ctrl.signal })
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(f.original.setSummaryEmbedding).toHaveBeenCalledOnce())
    ctrl.abort()
    write.resolve()
    await rejected
  })

  it('does not begin theme embedding when canceled during summary-vector admission', async () => {
    const f = fixture()
    const eligibility = deferred<boolean>()
    f.embedder.isReady.mockReturnValue(true)
    f.original.hasSummaryEmbeddings.mockReturnValueOnce(eligibility.promise)
    const ctrl = new AbortController()
    const qa = new QAService(f.db as never, {} as never, f.registry as never, f.summarize)
    const events: Array<{ type: string }> = []
    const run = (async () => {
      for await (const event of qa.answer(
        3,
        'How many documents about chemistry?',
        { language: 'en' },
        ctrl.signal,
      ))
        events.push(event)
    })()
    await vi.waitFor(() => expect(f.original.hasSummaryEmbeddings).toHaveBeenCalledOnce())
    ctrl.abort()
    eligibility.resolve(true)
    await run
    expect(f.embedder.embed).not.toHaveBeenCalled()
    expect(f.original.searchDocumentsByTheme).not.toHaveBeenCalled()
    expect(events.some((event) => ['done', 'refusal', 'token', 'error'].includes(event.type))).toBe(
      false,
    )
  })

  it('stops a corpus route after its current embedding instead of returning a canceled answer', async () => {
    const f = fixture()
    const model = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.isReady.mockReturnValue(true)
    f.embedder.embed.mockReturnValue(model.promise)
    const ctrl = new AbortController()
    const qa = new QAService(f.db as never, {} as never, f.registry as never, f.summarize)
    const events: Array<{ type: string }> = []
    const running = (async () => {
      for await (const event of qa.answer(
        3,
        'How many documents about chemistry?',
        { language: 'en' },
        ctrl.signal,
      ))
        events.push(event)
    })()
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    ctrl.abort()
    model.resolve([new Float32Array([1, 0])])
    await running
    expect(f.original.searchDocumentsByTheme).not.toHaveBeenCalled()
    expect(events.some((event) => ['done', 'refusal', 'token', 'error'].includes(event.type))).toBe(
      false,
    )
  })
})
