import type { EmbedderProvider } from '../types'
import type { OllamaClient } from './OllamaClient'
import { validateEmbeddingBatch } from '../../embeddings/validateBatch'

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
    const dimension = validateEmbeddingBatch(vectors, texts.length, this.dim ?? undefined)
    // Learn only from a wholly usable batch; a malformed first response must
    // not poison the provider's dimension for later successful requests.
    this.dim ??= dimension
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
