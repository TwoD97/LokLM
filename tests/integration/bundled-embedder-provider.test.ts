import { describe, it, expect, vi } from 'vitest'
import { BundledEmbedderProvider } from '@main/services/providers/bundled/BundledEmbedderProvider'

describe('BundledEmbedderProvider', () => {
  it('reports bundled:bge-m3 identity', () => {
    const p = new BundledEmbedderProvider({
      embedPassages: vi.fn(),
      isReady: () => true,
      ensureReady: vi.fn(),
      activeIdentity: () => 'bundled:bge-m3',
    } as never)
    expect(p.identity()).toBe('bundled:bge-m3')
  })

  it('reports 1024-dim (BGE-M3)', () => {
    const p = new BundledEmbedderProvider({
      embedPassages: vi.fn(),
      isReady: () => true,
      ensureReady: vi.fn(),
      activeIdentity: () => 'bundled:bge-m3',
    } as never)
    expect(p.dimension()).toBe(1024)
  })

  it('reflects the code model when Qwen3-Embedding is resident', () => {
    const p = new BundledEmbedderProvider({
      embedPassages: vi.fn(),
      isReady: () => true,
      ensureReady: vi.fn(),
      activeIdentity: () => 'bundled:qwen3-embedding',
    } as never)
    expect(p.identity()).toBe('bundled:qwen3-embedding')
    // Qwen3-Embedding-0.6B is 1024-dim, same as BGE-M3 (ADR-0006 code-embedder swap).
    expect(p.dimension()).toBe(1024)
  })

  it('embedQuery() delegates to embedQueries() (fix #1 query-instruction path)', async () => {
    const embedQueries = vi.fn().mockResolvedValue([[4, 5, 6]])
    const p = new BundledEmbedderProvider({
      embedPassages: vi.fn(),
      embedQueries,
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    const out = await p.embedQuery(['how does the auth class work'])
    expect(out[0]).toEqual(new Float32Array([4, 5, 6]))
    expect(embedQueries).toHaveBeenCalledWith(['how does the auth class work'])
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
