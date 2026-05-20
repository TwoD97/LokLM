import { describe, it, expect, vi } from 'vitest'
import { BundledEmbedderProvider } from '@main/services/providers/bundled/BundledEmbedderProvider'

describe('BundledEmbedderProvider', () => {
  it('reports bundled:bge-m3 identity', () => {
    const p = new BundledEmbedderProvider({
      embedPassages: vi.fn(),
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    expect(p.identity()).toBe('bundled:bge-m3')
  })

  it('reports 1024-dim (BGE-M3)', () => {
    const p = new BundledEmbedderProvider({
      embedPassages: vi.fn(),
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    expect(p.dimension()).toBe(1024)
  })

  it('delegates embed() to embedPassages() and converts number[] → Float32Array', async () => {
    const embedPassages = vi.fn().mockResolvedValue([[1, 2, 3]])
    const p = new BundledEmbedderProvider({
      embedPassages,
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    const out = await p.embed(['hello'])
    expect(out[0]).toEqual(new Float32Array([1, 2, 3]))
    expect(embedPassages).toHaveBeenCalledWith(['hello'])
  })

  it('throws when the underlying service returns null for a passage', async () => {
    const embedPassages = vi.fn().mockResolvedValue([null])
    const p = new BundledEmbedderProvider({
      embedPassages,
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    await expect(p.embed(['bad'])).rejects.toThrow()
  })
})
