import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

vi.mock('@main/services/retrieval/trace', () => ({ retrievalTrace: () => {} }))
afterEach(() => vi.unstubAllEnvs())

describe('query cache in production retrieval', () => {
  it.each([
    { raw: undefined, enabled: true },
    { raw: '', enabled: true },
    { raw: '1', enabled: true },
    { raw: '0', enabled: false },
  ])(
    'defaults on with an explicit opt-out (%j), while source searches always stay live',
    async ({ raw, enabled }) => {
      vi.stubEnv('LOKLM_QUERY_EMBEDDING_CACHE', raw)
      const { service, lexical, dense, embed, embedder } = retrievalHarness()
      Object.assign(embedder, { queryCacheKey: (query: string) => query })
      lexical.mockResolvedValue([hit(1)])
      dense.mockResolvedValue([hit(2)])
      await service.search(1, 'Revenue outlook', 2, FLAT)
      lexical.mockResolvedValue([hit(3)])
      dense.mockResolvedValue([hit(4)])
      const second = await service.search(1, 'Revenue outlook', 2, FLAT)
      expect(embed).toHaveBeenCalledTimes(enabled ? 1 : 2)
      expect(lexical).toHaveBeenCalledTimes(2)
      expect(dense).toHaveBeenCalledTimes(2)
      expect(second.map((item) => item.chunk_id)).toEqual([3, 4])
    },
  )

  it('bypasses providers without a reliable key under the enabled default', async () => {
    vi.stubEnv('LOKLM_QUERY_EMBEDDING_CACHE', undefined)
    const { service, embed } = retrievalHarness()
    await service.search(1, 'Revenue outlook', 2, FLAT)
    await service.search(1, 'Revenue outlook', 2, FLAT)
    expect(embed).toHaveBeenCalledTimes(2)
  })
})
