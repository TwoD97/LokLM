import type { EmbedderProvider } from '../types'
import type { OllamaClient } from './OllamaClient'

export class OllamaEmbedderProvider implements EmbedderProvider {
  private dim: number | null

  constructor(
    private readonly client: OllamaClient,
    private readonly model: string,
    knownDim: number | null = null,
  ) {
    this.dim = knownDim
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const data = await this.client.postJson<{ embeddings?: number[][] }>('/api/embed', {
      model: this.model,
      input: texts,
    })
    const vectors = data.embeddings ?? []
    if (vectors.length === 0) throw new Error('Ollama embed returned no vectors')
    // Callers (DocumentService, EmbeddingBackfillService) zip vectors back to
    // chunks by index, so a short or padded response would persist embeddings
    // against the wrong chunks. Fail loud rather than corrupt the vector store.
    if (vectors.length !== texts.length) {
      throw new Error(
        `Ollama embed count mismatch: requested ${texts.length}, received ${vectors.length}`,
      )
    }
    if (this.dim === null) this.dim = vectors[0]!.length
    return vectors.map((v) => Float32Array.from(v))
  }

  dimension(): number {
    if (this.dim === null)
      throw new Error('Ollama embedder dimension not yet known — call embed() first')
    return this.dim
  }

  identity(): string {
    return `ollama:${this.model}`
  }

  isReady(): boolean {
    return true
  }

  async ensureReady(): Promise<void> {
    /* HTTP — no preload */
  }
}
