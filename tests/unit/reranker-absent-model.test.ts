import { describe, it, expect, beforeEach, vi } from 'vitest'

// Force "no reranker GGUF anywhere on disk" deterministically, independent of
// whatever the dev machine happens to have under <repo>/models.
vi.mock('@main/services/models/paths', () => ({
  getModelSearchDirs: () => ['/loklm-nonexistent-models-dir'],
  resolveModelFile: () => null,
}))

import { RerankerService } from '@main/services/retrieval/RerankerService'

describe('RerankerService when the reranker model is absent', () => {
  beforeEach(() => {
    delete process.env.LOKLM_RERANKER_PATH
  })

  it('reports a benign unloaded state, not a red failure', async () => {
    const svc = new RerankerService()
    const ready = await svc.ensureReady()

    // A missing optional model is NOT an error: reranking is optional and RRF
    // retrieval still works (lite ships without it). The titlebar colours the
    // dot off the state string, so 'failed' would paint it red — it must be the
    // neutral 'unloaded' instead. A real load failure (model present, worker
    // errors) keeps 'failed'.
    expect(ready).toBe(false)
    expect(svc.isReady()).toBe(false)
    expect(svc.getStatus().state).toBe('unloaded')
  })
})
