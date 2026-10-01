import { describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '@main/services/providers/Registry'
import type {
  LlmProvider,
  EmbedderProvider,
  RerankerProvider,
} from '@main/services/providers/types'
import type { AskOptions } from '@main/services/llm/LlamaService'
import type { IndexingLease } from '@shared/modelActivity'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function providers() {
  const llm: LlmProvider = {
    ask: vi.fn(async () => 'answer'),
    generateRaw: vi.fn(async () => 'raw'),
    generateTitle: vi.fn(async () => 'title'),
    setLanguage: vi.fn(async () => {}),
    setCodebaseMode: vi.fn(async () => {}),
    contextWindowTokens: () => 4096,
    isReady: () => true,
    getStatus: () => ({ ready: true, message: null, identity: 'test' }),
    getModelStatus: () => ({
      state: 'ready',
      resident: true,
      modelPath: null,
      modelName: 'test',
      gpu: null,
      loadProgress: null,
      message: null,
      profile: null,
      source: 'bundled',
      fallback: { active: false, reason: null },
    }),
  }
  const embedder: EmbedderProvider = {
    embed: vi.fn(async () => [Float32Array.of(1)]),
    dimension: () => 1,
    identity: () => 'test',
    ensureReady: vi.fn(async () => {}),
    isReady: () => true,
  }
  const reranker: RerankerProvider = {
    rerank: vi.fn(async () => [0.9]),
    ensureReady: vi.fn(async () => {}),
    isReady: () => true,
  }
  return { llm, embedder, reranker }
}

function setup() {
  const bundled = providers()
  const ollama = providers()
  const onFallback = vi.fn()
  const onLlmStatusChanged = vi.fn()
  const deps = {
    llm: { bundled: bundled.llm, ollama: ollama.llm },
    embedder: { bundled: bundled.embedder, ollama: ollama.embedder },
    reranker: { bundled: bundled.reranker, ollama: ollama.reranker },
    onFallback,
    onLlmStatusChanged,
  }
  return {
    bundled,
    ollama,
    onFallback,
    onLlmStatusChanged,
    deps,
    registry: new ProviderRegistry(deps),
  }
}

describe('provider registry session retirement', () => {
  it('uses the active capacity hook and rejects a capacity result from a retired session', async () => {
    const { registry, bundled } = setup()
    const pending = deferred<number>()
    bundled.llm.prepareContext = vi.fn(() => pending.promise)
    const llm = registry.llm()
    const result = llm.prepareContext!()
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    registry.invalidateSession()
    pending.resolve(4096)
    await rejected
    await expect(llm.prepareContext!()).rejects.toMatchObject({ name: 'AbortError' })
    expect(bundled.llm.prepareContext).toHaveBeenCalledOnce()
  })

  it('reads remote advertised capacity without warming bundled models', async () => {
    const { registry, bundled, ollama } = setup()
    bundled.llm.prepareContext = vi.fn(async () => 8192)
    ollama.llm.contextWindowTokens = () => 16384
    registry.setLlmSource('ollama')
    await expect(registry.llm().prepareContext!()).resolves.toBe(16384)
    expect(bundled.llm.prepareContext).not.toHaveBeenCalled()
  })
  it('never reranks old passages locally after a late external failure and fresh login', async () => {
    const { registry, deps, bundled, ollama } = setup()
    const pending = deferred<number[]>()
    vi.mocked(ollama.reranker.rerank).mockReturnValue(pending.promise)
    registry.setRerankerSource('ollama')
    const oldResult = registry.reranker().rerank('private old question', ['old passage'])
    const rejected = expect(oldResult).rejects.toMatchObject({ name: 'AbortError' })
    registry.invalidateSession()
    const fresh = new ProviderRegistry(deps)
    expect(await fresh.reranker().rerank('new question', ['new passage'])).toEqual([0.9])
    pending.reject(Object.assign(new Error('Offline'), { kind: 'network' }))
    await rejected
    expect(bundled.reranker.rerank).toHaveBeenCalledExactlyOnceWith('new question', ['new passage'])
  })

  it.each(['ask', 'generateRaw', 'generateTitle'] as const)(
    'blocks retired %s fallback and status events',
    async (method) => {
      const { registry, bundled, ollama, onFallback } = setup()
      const pending = deferred<string>()
      vi.mocked(ollama.llm[method]).mockReturnValue(pending.promise)
      registry.setLlmSource('ollama')
      const llm = registry.llm()
      const result =
        method === 'ask'
          ? llm.ask('q', [], {})
          : method === 'generateRaw'
            ? llm.generateRaw('q', {})
            : llm.generateTitle('q', 'a')
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      registry.invalidateSession()
      pending.reject(Object.assign(new Error('Offline'), { kind: 'network' }))
      await rejected
      expect(bundled.llm[method]).not.toHaveBeenCalled()
      expect(onFallback).not.toHaveBeenCalled()
      expect(llm.isReady()).toBe(false)
      expect(llm.getModelStatus()).toMatchObject({ state: 'unloaded', resident: false })
    },
  )

  it('drops late token pushes and the completed answer', async () => {
    const { registry, bundled } = setup()
    const pending = deferred<string>()
    let options!: AskOptions
    vi.mocked(bundled.llm.ask).mockImplementation((_q, _h, opts) => {
      options = opts
      return pending.promise
    })
    const onChunk = vi.fn()
    const result = registry.llm().ask('q', [], { onChunk })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    options.onChunk?.('before', 1)
    registry.invalidateSession()
    options.onChunk?.('after', 1)
    pending.resolve('private completed answer')
    await rejected
    expect(onChunk).toHaveBeenCalledExactlyOnceWith('before', 1)
  })

  it('guards captured bundled/candidate providers and invalidates late vectors', async () => {
    const { registry, bundled, ollama } = setup()
    const pending = deferred<Float32Array[]>()
    vi.mocked(bundled.embedder.embed).mockReturnValue(pending.promise)
    const embedder = registry.bundledEmbedder()
    const candidate = registry.candidateEmbedder('ollama')!
    const llm = registry.bundledLlm()
    const reranker = registry.bundledReranker()
    const result = embedder.embed(['old private passage'])
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    registry.invalidateSession()
    pending.resolve([Float32Array.of(1)])
    await rejected
    await expect(candidate.embed(['old'])).rejects.toMatchObject({ name: 'AbortError' })
    await expect(candidate.ensureReady()).rejects.toMatchObject({ name: 'AbortError' })
    await expect(llm.ask('old', [], {})).rejects.toMatchObject({ name: 'AbortError' })
    await expect(reranker.rerank('old', ['old'])).rejects.toMatchObject({ name: 'AbortError' })
    expect(ollama.embedder.embed).not.toHaveBeenCalled()
    expect(bundled.llm.ask).not.toHaveBeenCalled()
    expect(bundled.reranker.rerank).not.toHaveBeenCalled()
  })

  it('preserves optional embedder capabilities and cache identity, including replacement', async () => {
    const { registry, bundled, ollama } = setup()
    bundled.embedder.embedQuery = vi.fn(async () => [Float32Array.of(2)])
    bundled.embedder.queryCacheKey = vi.fn(() => 'revision:query')
    bundled.embedder.preferredBatchSize = () => 4
    bundled.embedder.isResident = () => true
    const wrapped = registry.embedder()
    expect(registry.embedder()).toBe(wrapped)
    expect(registry.bundledEmbedder()).toBe(wrapped)
    expect(registry.candidateEmbedder('bundled')).toBe(wrapped)
    expect(wrapped.preferredBatchSize?.()).toBe(4)
    expect(wrapped.isResident?.()).toBe(true)
    await expect(wrapped.embedQuery?.(['q'], { codebase: true })).resolves.toEqual([
      Float32Array.of(2),
    ])
    expect(bundled.embedder.embedQuery).toHaveBeenCalledWith(['q'], { codebase: true })
    expect(wrapped.queryCacheKey?.('q')).toBe('revision:query')
    registry.setEmbedderSource('ollama')
    const remote = registry.embedder()
    expect(remote.embedQuery).toBeUndefined()
    expect(remote.beginIndexing).toBeUndefined()
    expect(remote.isResident).toBeUndefined()
    expect(registry.embedder()).toBe(remote)
    registry.replaceOllama({
      llm: ollama.llm,
      embedder: providers().embedder,
      reranker: ollama.reranker,
    })
    expect(registry.embedder()).not.toBe(remote)
    registry.invalidateSession()
    expect(wrapped.queryCacheKey?.('q')).toBeNull()
    expect(wrapped.isResident?.()).toBe(false)
  })

  it('releases a late indexing lease and suppresses updates after retirement', async () => {
    const { registry, bundled } = setup()
    const first = { update: vi.fn(), release: vi.fn() }
    const late = { update: vi.fn(), release: vi.fn() }
    const pending = deferred<IndexingLease>()
    bundled.embedder.beginIndexing = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(pending.promise)
    const provider = registry.embedder()
    const lease = await provider.beginIndexing!({ workspaceId: 1, title: 'first' })
    const result = provider.beginIndexing!({ workspaceId: 1, title: 'second' })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    registry.invalidateSession()
    pending.resolve(late)
    await rejected
    lease.update(1, 2)
    lease.release()
    expect(first.update).not.toHaveBeenCalled()
    expect(first.release).toHaveBeenCalledOnce()
    expect(late.release).toHaveBeenCalledOnce()
  })

  it('does not continue a settings operation on another provider after retirement', async () => {
    const { registry, bundled, ollama } = setup()
    const pending = deferred<void>()
    vi.mocked(bundled.llm.setLanguage).mockReturnValue(pending.promise)
    const result = registry.llm().setLanguage('de')
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    registry.invalidateSession()
    pending.resolve()
    await rejected
    expect(ollama.llm.setLanguage).not.toHaveBeenCalled()
    expect(() => registry.setLlmSource('ollama')).toThrow('session')
  })

  it('does not fall back after request cancellation even within a live session', async () => {
    const { registry, bundled, ollama } = setup()
    const pending = deferred<string>()
    vi.mocked(ollama.llm.generateRaw).mockReturnValue(pending.promise)
    registry.setLlmSource('ollama')
    const abort = new AbortController()
    const result = registry.llm().generateRaw('q', { abortSignal: abort.signal })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    pending.reject(Object.assign(new Error('Offline'), { kind: 'network' }))
    await rejected
    expect(bundled.llm.generateRaw).not.toHaveBeenCalled()
  })
})

describe('persistent LLM fallback status', () => {
  const unavailable = () => Object.assign(new Error('HTTP 503'), { kind: 'server' })

  it('pins the selected provider across preparation, settings replacement, language and ask', async () => {
    const { registry, ollama } = setup()
    const prepared = deferred<number>()
    ollama.llm.prepareContext = vi.fn(() => prepared.promise)
    ollama.llm.contextWindowTokens = () => 4096
    registry.setLlmSource('ollama')
    const turn = registry.llm()
    const capacity = turn.prepareContext!()
    const replacement = providers().llm
    replacement.contextWindowTokens = () => 16384
    registry.replaceOllama({ llm: replacement, embedder: null, reranker: null })
    prepared.resolve(4096)
    await expect(capacity).resolves.toBe(4096)
    expect(turn.contextWindowTokens()).toBe(4096)
    await turn.setLanguage('en')
    await turn.setCodebaseMode?.(true)
    await turn.ask('q', [], {})
    expect(ollama.llm.setLanguage).toHaveBeenCalledWith('en')
    expect(ollama.llm.setCodebaseMode).toHaveBeenCalledWith(true)
    expect(ollama.llm.ask).toHaveBeenCalledOnce()
    expect(replacement.setLanguage).not.toHaveBeenCalled()
    expect(replacement.setCodebaseMode).not.toHaveBeenCalled()
    expect(replacement.ask).not.toHaveBeenCalled()
    expect(registry.llm().contextWindowTokens()).toBe(16384)
  })

  it('ignores fallback status from an old captured provider first invoked after reconfiguration', async () => {
    const { registry, ollama, onFallback, onLlmStatusChanged } = setup()
    registry.setLlmSource('ollama')
    const oldTurn = registry.llm()
    registry.replaceOllama({ llm: providers().llm, embedder: null, reranker: null })
    vi.mocked(ollama.llm.ask).mockRejectedValue(unavailable())
    await oldTurn.ask('old prepared question', [], {})
    expect(ollama.llm.ask).toHaveBeenCalledOnce()
    expect(registry.getLlmFallback()).toEqual({ active: false, reason: null })
    expect(onFallback).not.toHaveBeenCalled()
    expect(onLlmStatusChanged).not.toHaveBeenCalled()
  })

  it('publishes fallback before local loading and preserves live local residency status', async () => {
    const { registry, bundled, ollama, onLlmStatusChanged } = setup()
    const pending = deferred<string>()
    vi.mocked(ollama.llm.ask).mockRejectedValue(unavailable())
    vi.mocked(bundled.llm.ask).mockImplementation(() => {
      expect(registry.getLlmFallback()).toEqual({ active: true, reason: 'HTTP 503' })
      return pending.promise
    })
    const ready = bundled.llm.getModelStatus()
    bundled.llm.getModelStatus = () => ({ ...ready, state: 'loading', resident: false })
    registry.setLlmSource('ollama')
    const request = registry.llm().ask('q', [], {})
    await vi.waitFor(() => expect(bundled.llm.ask).toHaveBeenCalledOnce())
    expect(registry.llm().getModelStatus()).toMatchObject({
      state: 'loading',
      resident: false,
      source: 'ollama',
      fallback: { active: true },
    })
    bundled.llm.getModelStatus = () => ready
    pending.resolve('Local answer')
    await request
    expect(registry.llm().getModelStatus()).toMatchObject({
      state: 'ready',
      resident: true,
      fallback: { active: true, reason: 'HTTP 503' },
    })
    expect(onLlmStatusChanged).toHaveBeenCalledOnce()
    const snapshot = registry.getLlmFallback()
    snapshot.active = false
    expect(registry.getLlmFallback().active).toBe(true)
  })

  it('clears the snapshot only after a successful remote operation and emits recovery', async () => {
    const { registry, ollama, onLlmStatusChanged } = setup()
    vi.mocked(ollama.llm.ask).mockRejectedValueOnce(unavailable())
    registry.setLlmSource('ollama')
    await registry.llm().ask('q', [], {})
    const recovery = deferred<string>()
    vi.mocked(ollama.llm.ask).mockReturnValueOnce(recovery.promise)
    const request = registry.llm().ask('again', [], {})
    expect(registry.getLlmFallback().active).toBe(true)
    recovery.resolve('Remote answer')
    await request
    expect(registry.getLlmFallback()).toEqual({ active: false, reason: null })
    expect(onLlmStatusChanged).toHaveBeenCalledTimes(2)
  })

  it('does not treat an unavailable optional title as remote recovery', async () => {
    const { registry, ollama } = setup()
    vi.mocked(ollama.llm.ask).mockRejectedValueOnce(unavailable())
    vi.mocked(ollama.llm.generateTitle).mockResolvedValue(null)
    registry.setLlmSource('ollama')
    await registry.llm().ask('q', [], {})
    await registry.llm().generateTitle('q', 'a')
    expect(registry.getLlmFallback().active).toBe(true)
  })

  it('does not let an older successful request clear a newer fallback', async () => {
    const { registry, ollama } = setup()
    const older = deferred<string>()
    vi.mocked(ollama.llm.ask)
      .mockReturnValueOnce(older.promise)
      .mockRejectedValueOnce(unavailable())
    registry.setLlmSource('ollama')
    const oldRequest = registry.llm().ask('old', [], {})
    await registry.llm().ask('new', [], {})
    older.resolve('Old remote answer')
    await oldRequest
    expect(registry.getLlmFallback()).toEqual({ active: true, reason: 'HTTP 503' })
  })

  it('does not let an old configuration publish fallback after replacement', async () => {
    const { registry, ollama, onFallback, onLlmStatusChanged } = setup()
    const older = deferred<string>()
    vi.mocked(ollama.llm.ask).mockReturnValue(older.promise)
    registry.setLlmSource('ollama')
    const oldRequest = registry.llm().ask('old', [], {})
    registry.replaceOllama({ llm: providers().llm, embedder: null, reranker: null })
    older.reject(unavailable())
    await oldRequest
    expect(registry.getLlmFallback()).toEqual({ active: false, reason: null })
    expect(onFallback).not.toHaveBeenCalled()
    expect(onLlmStatusChanged).not.toHaveBeenCalled()
  })

  it.each(['source', 'configuration', 'session'] as const)(
    'clears fallback on %s change',
    async (change) => {
      const { registry, ollama } = setup()
      vi.mocked(ollama.llm.ask).mockRejectedValue(unavailable())
      registry.setLlmSource('ollama')
      await registry.llm().ask('q', [], {})
      if (change === 'source') registry.setLlmSource('bundled')
      else if (change === 'configuration')
        registry.replaceOllama({ llm: null, embedder: null, reranker: null })
      else registry.invalidateSession()
      expect(registry.getLlmFallback()).toEqual({ active: false, reason: null })
    },
  )
})
