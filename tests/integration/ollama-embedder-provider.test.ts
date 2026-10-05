import { describe, it, expect, vi } from 'vitest'
import { OllamaEmbedderProvider } from '@main/services/providers/ollama/OllamaEmbedderProvider'

describe('OllamaEmbedderProvider', () => {
  it('propagates cancellation and does not learn a dimension from a late response', async () => {
    const controller = new AbortController()
    const client = {
      postJson: vi.fn(async () => {
        controller.abort()
        return { embeddings: [[1, 2, 3]] }
      }),
    }
    const provider = new OllamaEmbedderProvider(client as never, 'fixture')
    await expect(
      provider.embed(['text'], { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postJson).toHaveBeenCalledExactlyOnceWith(
      '/api/embed',
      { model: 'fixture', input: ['text'] },
      controller.signal,
    )
    expect(() => provider.dimension()).toThrow(/not yet known/)
  })

  it('does not send an already-cancelled batch', async () => {
    const client = { postJson: vi.fn() }
    const provider = new OllamaEmbedderProvider(client as never, 'fixture')
    await expect(
      provider.embed(['text'], { abortSignal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postJson).not.toHaveBeenCalled()
  })

  it('embeds and returns Float32Array per input', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
    }
    const p = new OllamaEmbedderProvider(client as never, 'nomic-embed-text', 3)
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

  it('throws when the returned vector count does not match the input count', async () => {
    // Callers zip vectors back to chunks by index (DocumentService,
    // EmbeddingBackfillService). A short/misaligned response would persist
    // embeddings against the wrong chunks — fail loud instead of corrupting.
    const client = {
      postJson: vi.fn().mockResolvedValue({
        embeddings: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }),
    }
    const p = new OllamaEmbedderProvider(client as never, 'nomic-embed-text', 3)
    await expect(p.embed(['a', 'b', 'c'])).rejects.toThrow(/mismatch/i)
  })

  it.each(
    [
      [[]],
      [[1, NaN]],
      [[1, Infinity]],
      [[1, 1e100]],
      [[0, 0]],
      [[1e-300, 0]],
      [['1', '2']],
      [null],
    ].map((embeddings) => ({ embeddings })),
  )(
    'rejects unusable vector output without learning a bad dimension: %j',
    async ({ embeddings }) => {
      const client = {
        postJson: vi
          .fn()
          .mockResolvedValueOnce({ embeddings })
          .mockResolvedValueOnce({ embeddings: [[1, 2, 3]] }),
      }
      const p = new OllamaEmbedderProvider(client as never, 'fixture', null)
      await expect(p.embed(['source'])).rejects.toThrow()
      expect(() => p.dimension()).toThrow(/not yet known/)
      await p.embed(['source'])
      expect(p.dimension()).toBe(3)
    },
  )

  it('rejects a changed or mixed dimension before downstream storage can be marked embedded', async () => {
    const client = {
      postJson: vi
        .fn()
        .mockResolvedValueOnce({
          embeddings: [
            [1, 2],
            [1, 2, 3],
          ],
        })
        .mockResolvedValueOnce({ embeddings: [[1, 2, 3]] }),
    }
    const p = new OllamaEmbedderProvider(client as never, 'fixture', 2)
    await expect(p.embed(['first', 'second'])).rejects.toThrow(/dimension mismatch/)
    await expect(p.embed(['source'])).rejects.toThrow(/dimension mismatch/)
    expect(p.dimension()).toBe(2)
  })
})
