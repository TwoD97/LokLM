import type { EmbeddingService } from '../../embeddings/EmbeddingService'
import { BUNDLED_EMBEDDER_IDENTITY } from '../../embeddings/EmbeddingService'
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

  dimension(): number {
    return 1024 // BGE-M3
  }

  identity(): string {
    return BUNDLED_EMBEDDER_IDENTITY
  }

  isReady(): boolean {
    return this.inner.isReady()
  }

  async ensureReady(): Promise<void> {
    await this.inner.ensureReady()
  }
}
