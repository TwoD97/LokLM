import type { EmbeddingService } from '../../embeddings/EmbeddingService'
import { EMBEDDING_DIM } from '../../embeddings/EmbeddingService'
import { CODE_EMBEDDER_IDENTITY, CODE_EMBEDDING_DIM } from '../../codebase/codeEmbedder'
import type { EmbedderProvider, ProviderRequestOptions } from '../types'
import type { IndexingJob, IndexingLease } from '../../../../shared/modelActivity'
import { validateEmbeddingBatch } from '../../embeddings/validateBatch'

/**
 * Adapts the bundled BGE-M3 EmbeddingService to the EmbedderProvider contract.
 *
 * Two shape mismatches to bridge:
 *   - EmbeddingService.embedPassages() returns number[] | null per passage
 *     (null = chunk was empty after sanitize / model rejected it). The
 *     provider contract is non-nullable Float32Array[], so we throw on null —
 *     callers that want best-effort embedding should keep using the raw
 *     service.
 *   - EmbeddingService.ensureReady() returns boolean (false = no model file
 *     on disk, fall back to BM25). The interface promises void; we discard
 *     the boolean. Callers who care still get the truth via isReady().
 */
export class BundledEmbedderProvider implements EmbedderProvider {
  constructor(private readonly inner: EmbeddingService) {}

  beginIndexing(job: Omit<IndexingJob, 'done' | 'total'>): Promise<IndexingLease> {
    return this.inner.beginIndexing(job)
  }

  preferredBatchSize(): number {
    return 4
  }

  async embed(texts: string[], opts?: ProviderRequestOptions): Promise<Float32Array[]> {
    opts?.abortSignal?.throwIfAborted()
    const raw = await this.inner.embedPassages(texts)
    opts?.abortSignal?.throwIfAborted()
    validateEmbeddingBatch(raw, texts.length, this.dimension())
    return raw.map((v, i) => {
      if (v === null) {
        throw new Error(`BundledEmbedderProvider: passage #${i} could not be embedded`)
      }
      return new Float32Array(v)
    })
  }

  /** Query path (ADR-0006 fix #1): routes to EmbeddingService.embedQueries, which
   *  prepends the code model's Instruct/Query template (BGE-M3: none). Same
   *  null-means-unembeddable contract as embed(). */
  async embedQuery(
    texts: string[],
    opts?: ProviderRequestOptions & { codebase?: boolean },
  ): Promise<Float32Array[]> {
    opts?.abortSignal?.throwIfAborted()
    const raw = await this.inner.embedQueries(texts, opts)
    opts?.abortSignal?.throwIfAborted()
    validateEmbeddingBatch(raw, texts.length, this.dimension())
    return raw.map((v, i) => {
      if (v === null) {
        throw new Error(`BundledEmbedderProvider: query #${i} could not be embedded`)
      }
      return new Float32Array(v)
    })
  }

  queryCacheKey(query: string, opts?: { codebase?: boolean }): string | null {
    return this.inner.queryCacheKey(query, opts)
  }

  dimension(): number {
    // ADR-0006: reflects the resident model by identity — the code embedder
    // (Qwen3-Embedding) vs BGE-M3. Both are 1024-dim now, but keep this
    // identity-driven so a future code model with a different dim stays correct.
    return this.inner.activeIdentity() === CODE_EMBEDDER_IDENTITY
      ? CODE_EMBEDDING_DIM
      : EMBEDDING_DIM
  }

  identity(): string {
    return this.inner.activeIdentity()
  }

  isReady(): boolean {
    return this.inner.isReady()
  }

  isResident(): boolean {
    return this.inner.isReady() && this.inner.getStatus().resident === true
  }

  async ensureReady(): Promise<void> {
    await this.inner.ensureReady()
  }
}
