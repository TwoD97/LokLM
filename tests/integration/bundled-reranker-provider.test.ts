import { describe, it, expect, vi } from 'vitest'
import { BundledRerankerProvider } from '@main/services/providers/bundled/BundledRerankerProvider'

describe('BundledRerankerProvider', () => {
  it('delegates rerank() to the wrapped service rank() method', async () => {
    const rank = vi.fn().mockResolvedValue([0.8, 0.3])
    const p = new BundledRerankerProvider({
      rank,
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    const out = await p.rerank('q', ['a', 'b'])
    expect(out).toEqual([0.8, 0.3])
    expect(rank).toHaveBeenCalledWith('q', ['a', 'b'])
  })

  it('throws when the underlying service returns null (model missing / failed)', async () => {
    const rank = vi.fn().mockResolvedValue(null)
    const p = new BundledRerankerProvider({
      rank,
      isReady: () => true,
      ensureReady: vi.fn(),
    } as never)
    await expect(p.rerank('q', ['a'])).rejects.toThrow()
  })
})
