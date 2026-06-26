import type { EmbeddingService } from '../../embeddings/EmbeddingService'
import { EMBEDDING_DIM } from '../../embeddings/EmbeddingService'
import { CODE_EMBEDDER_IDENTITY, CODE_EMBEDDING_DIM } from '../../codebase/codeEmbedder'
import type { EmbedderProvider } from '../types'

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

  async embed(texts: string[]): Promise<Float32Array[]> {
    const raw = await this.inner.embedPassages(texts)
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
  async embedQuery(texts: string[], opts?: { codebase?: boolean }): Promise<Float32Array[]> {
    const raw = await this.inner.embedQueries(texts, opts)
    return raw.map((v, i) => {
      if (v === null) {
        throw new Error(`BundledEmbedderProvider: query #${i} could not be embedded`)
      }
      return new Float32Array(v)
    })
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

  async ensureReady(): Promise<void> {
    await this.inner.ensureReady()
  }
}
