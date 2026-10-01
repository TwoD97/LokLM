import { describe, expect, it, vi } from 'vitest'
import { SummarizationService } from '@main/services/summarize/SummarizationService'
import { estimateTokens } from '@main/services/llm/prompt'
import { deferred } from './fixtures/retrievalHarness'

vi.mock('@main/services/documents/languageDetector', () => ({
  detectResponseLanguage: async () => 'en',
}))

function fixture() {
  const chunks = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    ordinal: index,
    text: `UNIQUE_SECTION_${index} ` + 'source facts '.repeat(150),
    token_count: null,
  }))
  const repo = {
    getDocument: async () => ({
      id: 1,
      workspaceId: 1,
      title: 'Long source',
      status: 'ready',
      summary: null,
      contentHash: 'source-v1',
    }),
    listChunksForDocument: async () => chunks,
    setSummary: vi.fn(async () => true),
  }
  const db = { documentsFor: async () => repo }
  const llm = {
    isReady: () => true,
    contextWindowTokens: () => 8192,
    prepareContext: vi.fn(async () => 4096),
    generateRaw: vi.fn<(prompt: string, options: object) => Promise<string>>(async () =>
      'Condensed source facts. '.repeat(70),
    ),
  }
  const registry = { llm: () => llm, embedder: () => ({ isReady: () => false }) }
  const service = new SummarizationService(db as never, registry as never)
  return { chunks, repo, llm, service }
}

describe('bounded long-document summarization', () => {
  it('keeps the documented context fallback for remote providers whose prepare hook reports unknown', async () => {
    const f = fixture()
    f.chunks.length = 1
    f.llm.prepareContext.mockResolvedValue(0)
    await expect(f.service.summarize(1, { workspaceId: 1 })).resolves.toMatchObject({
      cached: false,
    })
    expect(f.llm.generateRaw).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ plannedContextTokens: 8192 }),
    )
  })

  it.each(['', ' \n\t '])(
    'rejects empty indexed content before loading the model (%j)',
    async (text) => {
      const f = fixture()
      for (const chunk of f.chunks) chunk.text = text
      await expect(f.service.summarize(1, { workspaceId: 1 })).rejects.toMatchObject({
        code: 'no_content',
      })
      expect(f.llm.prepareContext).not.toHaveBeenCalled()
      expect(f.llm.generateRaw).not.toHaveBeenCalled()
      expect(f.repo.setSummary).not.toHaveBeenCalled()
    },
  )

  it('reduces in bounded stages instead of concatenating all partials into an oversized final prompt', async () => {
    const f = fixture()
    const result = await f.service.summarize(1, { workspaceId: 1 })
    expect(result.cached).toBe(false)
    expect(f.llm.prepareContext).toHaveBeenCalledOnce()
    const prompts = f.llm.generateRaw.mock.calls.map(([prompt]) => prompt)
    const maps = prompts.filter((prompt) => prompt.includes('Excerpt:'))
    const reductions = prompts.filter((prompt) => prompt.includes('Section summaries:'))
    expect(maps.length).toBeGreaterThan(4)
    expect(reductions.length).toBeGreaterThan(1)
    for (const chunk of f.chunks) {
      const marker = chunk.text.split(' ')[0]!
      expect(maps.filter((prompt) => prompt.includes(marker + ' '))).toHaveLength(1)
    }
    for (const [prompt, options] of f.llm.generateRaw.mock.calls) {
      expect(estimateTokens(prompt) + 512 + 192).toBeLessThanOrEqual(4096)
      expect(options).toMatchObject({ plannedContextTokens: 4096 })
    }
    expect(f.repo.setSummary).toHaveBeenCalledOnce()
  })

  it('rejects non-condensing output after bounded work without publishing a misleading summary', async () => {
    const f = fixture()
    f.llm.generateRaw.mockResolvedValue('oversized model output '.repeat(700))
    await expect(f.service.summarize(1, { workspaceId: 1 })).rejects.toThrow('did not condense')
    expect(f.repo.setSummary).not.toHaveBeenCalled()
    expect(f.llm.generateRaw.mock.calls.length).toBeLessThanOrEqual(f.chunks.length)
  })

  it('fails on an empty map result rather than silently dropping that source section', async () => {
    const f = fixture()
    f.llm.generateRaw.mockResolvedValueOnce('')
    await expect(f.service.summarize(1, { workspaceId: 1 })).rejects.toThrow(
      'empty summary section',
    )
    expect(f.llm.generateRaw).toHaveBeenCalledOnce()
    expect(f.repo.setSummary).not.toHaveBeenCalled()
  })

  it('stops the remaining reduction calls and cache write when canceled during reduction', async () => {
    const f = fixture()
    const pending = deferred<string>()
    let reducing = false
    f.llm.generateRaw.mockImplementation(async (prompt) => {
      if (prompt.includes('Section summaries:')) {
        reducing = true
        return pending.promise
      }
      return 'Condensed source facts. '.repeat(70)
    })
    const ctrl = new AbortController()
    const running = f.service.summarize(1, { workspaceId: 1, abortSignal: ctrl.signal })
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(reducing).toBe(true))
    const calls = f.llm.generateRaw.mock.calls.length
    ctrl.abort()
    pending.resolve('Late combined summary')
    await rejected
    expect(f.llm.generateRaw).toHaveBeenCalledTimes(calls)
    expect(f.repo.setSummary).not.toHaveBeenCalled()
  })
})
