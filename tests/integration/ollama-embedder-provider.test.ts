import { describe, it, expect, vi } from 'vitest'
import { OllamaEmbedderProvider } from '@main/services/providers/ollama/OllamaEmbedderProvider'

describe('OllamaEmbedderProvider', () => {
  it('embeds and returns Float32Array per input', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
    }
    const p = new OllamaEmbedderProvider(client as never, 'nomic-embed-text', 768)
    const out = await p.embed(['hello'])
    expect(out).toHaveLength(1)
    expect(out[0]).toBeInstanceOf(Float32Array)
    // Float32 precision drift means we compare approximately:
    expect(Array.from(out[0]!)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])))
  })

  it('reports identity prefixed with ollama:', () => {
    const p = new OllamaEmbedderProvider({} as never, 'nomic-embed-text', 768)
    expect(p.identity()).toBe('ollama:nomic-embed-text')
  })

  it('learns the dimension from the first successful embed', async () => {
    const client = { postJson: vi.fn().mockResolvedValue({ embeddings: [[1, 2, 3, 4, 5]] }) }
    const p = new OllamaEmbedderProvider(client as never, 'nomic-embed-text', null)
    await p.embed(['x'])
    expect(p.dimension()).toBe(5)
  })
})
