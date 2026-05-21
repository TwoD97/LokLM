import { describe, it, expect, vi } from 'vitest'
import { BundledLlmProvider } from '@main/services/providers/bundled/BundledLlmProvider'

describe('BundledLlmProvider', () => {
  it('delegates ask() to the underlying LlamaService', async () => {
    const ask = vi.fn().mockResolvedValue('hello')
    const fake = {
      ask,
      generateRaw: vi.fn(),
      generateTitle: vi.fn(),
      isReady: () => true,
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getStatus: () => ({ state: 'ready', modelName: 'qwen3-4b' }) as never,
    }
    const p = new BundledLlmProvider(fake as never)
    const out = await p.ask('q', [], {})
    expect(out).toBe('hello')
    expect(ask).toHaveBeenCalledWith('q', [], {})
  })

  it('calls ensureLoaded before delegating ask (lazy-load on fallback)', async () => {
    const order: string[] = []
    const ensureLoaded = vi.fn().mockImplementation(async () => {
      order.push('ensureLoaded')
    })
    const ask = vi.fn().mockImplementation(async () => {
      order.push('ask')
      return 'ok'
    })
    const fake = {
      ask,
      generateRaw: vi.fn(),
      generateTitle: vi.fn(),
      isReady: () => true,
      ensureLoaded,
      getStatus: () => ({ state: 'ready', modelName: 'qwen3-4b' }) as never,
    }
    const p = new BundledLlmProvider(fake as never)
    await p.ask('q', [], {})
    expect(order).toEqual(['ensureLoaded', 'ask'])
  })

  it('reports identity from the wrapped status', () => {
    const fake = {
      ask: vi.fn(),
      generateRaw: vi.fn(),
      generateTitle: vi.fn(),
      isReady: () => true,
      getStatus: () => ({ state: 'ready', modelName: 'qwen3-4b.gguf' }) as never,
    }
    const p = new BundledLlmProvider(fake as never)
    expect(p.getStatus().identity).toBe('bundled:qwen3-4b.gguf')
  })
})
