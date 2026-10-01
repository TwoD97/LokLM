import { describe, expect, it } from 'vitest'
import { validateEmbeddingBatch } from '@main/services/embeddings/validateBatch'

describe('embedding batch validation', () => {
  it('accepts finite nonzero vectors without altering their values', () => {
    const first = new Float32Array([0, -0.2, 0.4])
    expect(validateEmbeddingBatch([first, [1, 0, 0]], 2, 3)).toBe(3)
    expect(first).toEqual(new Float32Array([0, -0.2, 0.4]))
  })
  it.each(
    [
      undefined,
      [],
      [[1, 2]],
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    ].map((vectors) => ({ vectors })),
  )('rejects mismatched output before zipping rows: %j', ({ vectors }) => {
    expect(() => validateEmbeddingBatch(vectors, 2)).toThrow(/count mismatch/)
  })
  it('checks every vector rather than trusting the first valid dimension', () => {
    expect(() => validateEmbeddingBatch([[1, 2], [3]], 2)).toThrow(/dimension mismatch/)
    expect(() =>
      validateEmbeddingBatch(
        [
          [1, 2],
          [NaN, 1],
        ],
        2,
      ),
    ).toThrow(/nonfinite/)
    expect(() =>
      validateEmbeddingBatch(
        [
          [1, 2],
          [0, 0],
        ],
        2,
      ),
    ).toThrow(/zero vector/)
  })
})
