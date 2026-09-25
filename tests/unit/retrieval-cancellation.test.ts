import { afterEach, describe, expect, it, vi } from 'vitest'
import { deferred, FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

vi.mock('@main/services/retrieval/trace', () => ({ retrievalTrace: () => {} }))
afterEach(() => vi.restoreAllMocks())

describe('retrieval request cancellation', () => {
  it('does not begin work for an already canceled request', async () => {
    const { service, lexical, generate, embed } = retrievalHarness()
    await expect(
      service.search(1, 'Revenue outlook', 10, { ...FLAT, abortSignal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(lexical).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    expect(embed).not.toHaveBeenCalled()
  })

  it('forwards cancellation to expansion and never continues with the original query', async () => {
    const ctrl = new AbortController()
    const pending = deferred<string>()
    const { service, lexical, generate } = retrievalHarness()
    generate.mockReturnValue(pending.promise)
    const result = service.search(1, 'Revenue outlook', 10, {
      ...FLAT,
      multiQuery: true,
      abortSignal: ctrl.signal,
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalled())
    expect(generate.mock.calls[0]![1]).toMatchObject({ abortSignal: ctrl.signal })
    ctrl.abort()
    pending.resolve('Another question\nA second question')
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(lexical).not.toHaveBeenCalled()
  })

  it('passes the request signal through translation and discards late translated results', async () => {
    const ctrl = new AbortController()
    const pending = deferred<string | null>()
    const translate = vi.fn().mockReturnValue(pending.promise)
    const { service, lexical } = retrievalHarness({ translate })
    const result = service.search(1, 'Wie hoch war der Umsatz', 10, {
      ...FLAT,
      cpuOptimized: false,
      abortSignal: ctrl.signal,
    })
    await vi.waitFor(() => expect(translate).toHaveBeenCalled())
    expect(translate).toHaveBeenCalledWith('Wie hoch war der Umsatz', { abortSignal: ctrl.signal })
    ctrl.abort()
    pending.resolve('What was the revenue')
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(lexical).not.toHaveBeenCalled()
  })

  it('discards a query embedding finished after cancellation without a lexical fallback', async () => {
    const ctrl = new AbortController()
    const pending = deferred<Float32Array[]>()
    const { service, lexical, embed, dense, rank } = retrievalHarness()
    lexical.mockResolvedValue([hit(1)])
    embed.mockReturnValue(pending.promise)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = service.search(1, 'Revenue outlook', 10, { ...FLAT, abortSignal: ctrl.signal })
    await vi.waitFor(() => expect(embed).toHaveBeenCalled())
    ctrl.abort()
    pending.resolve([new Float32Array([1, 0])])
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(dense).not.toHaveBeenCalled()
    expect(rank).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not turn a canceled reranking request into successful hybrid fallback', async () => {
    const ctrl = new AbortController()
    const pending = deferred<number[]>()
    const { service, lexical, rank, rerankerReady } = retrievalHarness()
    lexical.mockResolvedValue([hit(1)])
    rerankerReady.mockReturnValue(true)
    rank.mockReturnValue(pending.promise)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = service.search(1, 'Revenue outlook', 10, {
      ...FLAT,
      rerank: true,
      abortSignal: ctrl.signal,
    })
    await vi.waitFor(() => expect(rank).toHaveBeenCalled())
    ctrl.abort()
    pending.reject(new Error('Native work ended'))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['resolves', 'rejects'] as const)(
    'discards vector search that %s after cancellation without lexical fallback',
    async (outcome) => {
      const ctrl = new AbortController()
      const pending = deferred<ReturnType<typeof hit>[]>()
      const { service, lexical, dense, rank } = retrievalHarness()
      lexical.mockResolvedValue([hit(1)])
      dense.mockReturnValue(pending.promise)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = service.search(1, 'Revenue outlook', 10, { ...FLAT, abortSignal: ctrl.signal })
      await vi.waitFor(() => expect(dense).toHaveBeenCalled())
      ctrl.abort()
      if (outcome === 'resolves') pending.resolve([hit(101)])
      else pending.reject(new Error('Vector search interrupted'))
      await expect(result).rejects.toMatchObject({ name: 'AbortError' })
      expect(rank).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    },
  )

  it('does not swallow a provider AbortError even before the shared signal is marked', async () => {
    const { service, generate, lexical } = retrievalHarness()
    generate.mockRejectedValue(new DOMException('Canceled by provider', 'AbortError'))
    await expect(
      service.search(1, 'Revenue outlook', 10, { ...FLAT, multiQuery: true }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(lexical).not.toHaveBeenCalled()
  })
})
