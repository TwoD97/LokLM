import { describe, it, expect, vi } from 'vitest'
import { ProviderRegistry } from '@main/services/providers/Registry'
import type {
  LlmProvider,
  EmbedderProvider,
  RerankerProvider,
} from '@main/services/providers/types'

function mkLlm(opts: { ask?: (q: string) => Promise<string>; ready?: boolean } = {}): LlmProvider {
  return {
    ask: vi.fn().mockImplementation((q: string) => (opts.ask ?? (async () => 'ok'))(q)),
    generateRaw: vi.fn(),
    generateTitle: vi.fn(),
    contextWindowTokens: () => 0,
    isReady: () => opts.ready ?? true,
    getStatus: () => ({ ready: true, message: null, identity: 'test' }),
    getModelStatus: () => ({}) as never,
    setLanguage: vi.fn(async () => {}),
  } as LlmProvider
}

function mkEmbedder(id = 'test'): EmbedderProvider {
  return {
    embed: vi.fn().mockResolvedValue([new Float32Array([1])]),
    dimension: () => 1,
    identity: () => id,
    isReady: () => true,
    ensureReady: vi.fn(),
  }
}

function mkReranker(): RerankerProvider {
  return {
    rerank: vi.fn().mockResolvedValue([1]),
    isReady: () => true,
    ensureReady: vi.fn(),
  }
}

describe('ProviderRegistry — LLM fallback', () => {
  it('uses the active provider on the happy path', async () => {
    const bundled = mkLlm({ ask: async () => 'bundled' })
    const ollama = mkLlm({ ask: async () => 'ollama' })
    const reg = new ProviderRegistry({
      llm: { bundled, ollama },
      embedder: { bundled: mkEmbedder('bundled'), ollama: mkEmbedder('ollama') },
      reranker: { bundled: mkReranker(), ollama: mkReranker() },
    })
    reg.setLlmSource('ollama')
    expect(await reg.llm().ask('q', [], {})).toBe('ollama')
  })

  it('falls back to bundled when active throws a network error', async () => {
    const bundled = mkLlm({ ask: async () => 'fallback' })
    const ollama = mkLlm({
      ask: async () => {
        throw Object.assign(new Error(), { kind: 'network' })
      },
    })
    const events: unknown[] = []
    const reg = new ProviderRegistry({
      llm: { bundled, ollama },
      embedder: { bundled: mkEmbedder('bundled'), ollama: mkEmbedder('ollama') },
      reranker: { bundled: mkReranker(), ollama: mkReranker() },
      onFallback: (ev) => events.push(ev),
    })
    reg.setLlmSource('ollama')
    expect(await reg.llm().ask('q', [], {})).toBe('fallback')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'llm' })
  })

  it('does not fall back on a 4xx client error (configuration)', async () => {
    const bundled = mkLlm({ ask: async () => 'bundled' })
    const ollama = mkLlm({
      ask: async () => {
        throw Object.assign(new Error('404'), { kind: 'client' })
      },
    })
    const reg = new ProviderRegistry({
      llm: { bundled, ollama },
      embedder: { bundled: mkEmbedder('bundled'), ollama: mkEmbedder('ollama') },
      reranker: { bundled: mkReranker(), ollama: mkReranker() },
    })
    reg.setLlmSource('ollama')
    await expect(reg.llm().ask('q', [], {})).rejects.toThrow()
  })

  it('reranker fallback is silent (no event)', async () => {
    const bundled = mkReranker()
    const ollama = mkReranker()
    ;(ollama.rerank as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error(), { kind: 'network' }),
    )
    const events: unknown[] = []
    const reg = new ProviderRegistry({
      llm: { bundled: mkLlm(), ollama: mkLlm() },
      embedder: { bundled: mkEmbedder('b'), ollama: mkEmbedder('o') },
      reranker: { bundled, ollama },
      onFallback: (ev) => events.push(ev),
    })
    reg.setRerankerSource('ollama')
    expect(await reg.reranker().rerank('q', ['a'])).toEqual([1])
    expect(events.find((e) => (e as { kind: string }).kind === 'reranker')).toBeUndefined()
  })

  it('embedder() returns the active provider directly (no fallback)', () => {
    const bundled = mkEmbedder('bundled')
    const ollama = mkEmbedder('ollama')
    const reg = new ProviderRegistry({
      llm: { bundled: mkLlm(), ollama: mkLlm() },
      embedder: { bundled, ollama },
      reranker: { bundled: mkReranker(), ollama: mkReranker() },
    })
    reg.setEmbedderSource('ollama')
    expect(reg.embedder().identity()).toBe('ollama')
    reg.setEmbedderSource('bundled')
    expect(reg.embedder().identity()).toBe('bundled')
  })
})
