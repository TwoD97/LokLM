import type { RerankerService } from '../../retrieval/RerankerService'
import type { RerankerProvider } from '../types'

/**
 * Adapts the bundled BGE-reranker RerankerService to the RerankerProvider
 * contract.
 *
 * Two shape mismatches to bridge:
 *   - RerankerService exposes rank(query, documents); the provider interface
 *     names it rerank(query, passages). Pure rename, no semantic change.
 *   - rank() returns number[] | null where null signals "no reranker model
 *     on disk OR scoring failed — fall back to RRF order". The provider
 *     contract is non-nullable, so we throw on null. Callers that want
 *     soft-fail behaviour should keep going through RerankerService directly.
 */
export class BundledRerankerProvider implements RerankerProvider {
  constructor(private readonly inner: RerankerService) {}

  async rerank(query: string, passages: string[]): Promise<number[]> {
    const scores = await this.inner.rank(query, passages)
    if (scores === null) {
      throw new Error('BundledRerankerProvider: rerank failed (model unavailable or scoring error)')
    }
    return scores
  }

  isReady(): boolean {
    return this.inner.isReady()
  }

  async ensureReady(): Promise<void> {
    await this.inner.ensureReady()
  }
}
