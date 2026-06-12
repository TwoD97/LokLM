import { describe, it, expect } from 'vitest'
import { MODEL_MANIFEST, getRequiredManifestEntries } from '../../src/main/services/models/manifest'

/**
 * The legacy first-launch manifest must never reacquire an LLM: since
 * v0.3.0 the installer wizard owns LLM acquisition (tier bundles), and the
 * one time the legacy path fired with an LLM entry it pulled an obsolete
 * 5 GB Qwen3-8B onto a machine that already had the wizard's Qwen3.5.
 */
describe('legacy MODEL_MANIFEST (first-launch fallback)', () => {
  it('contains no LLM entry — the wizard owns LLM acquisition', () => {
    expect(MODEL_MANIFEST.filter((m) => m.kind === 'llm')).toEqual([])
  })

  it('requires exactly the embedder and the reranker', () => {
    expect(
      getRequiredManifestEntries()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['bge-m3-Q4_K_M', 'bge-reranker-v2-m3-Q4_K_M'])
  })
})
