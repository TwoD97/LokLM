/** Reject unusable provider output before associating vectors with source rows.
 * Count/order is an all-or-nothing contract; partial arrays cannot be zipped
 * safely. Cosine search also requires finite, nonzero, equal-size vectors. */
export function validateEmbeddingBatch(
  vectors: unknown,
  expectedCount: number,
  expectedDimension?: number,
): number {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(
      `Embedding count mismatch: expected ${expectedCount}, received ${Array.isArray(vectors) ? vectors.length : 'invalid response'}.`,
    )
  }
  if (vectors.length === 0) return expectedDimension ?? 0
  const dimension = expectedDimension ?? vectors[0]?.length
  if (!Number.isSafeInteger(dimension) || dimension <= 0)
    throw new Error('Embedding dimension must be a positive integer.')
  for (let index = 0; index < vectors.length; index++) {
    const vector: unknown = vectors[index]
    if (!(Array.isArray(vector) || vector instanceof Float32Array) || vector.length !== dimension)
      throw new Error(`Embedding dimension mismatch for item ${index}: expected ${dimension}.`)
    let nonzero = false
    for (const value of vector) {
      // Validate the actual float32 representation stored in the vector index,
      // including overflow/underflow from an otherwise finite JSON number.
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isFinite(Math.fround(value))
      )
        throw new Error(`Embedding item ${index} contains a nonfinite value.`)
      if (Math.fround(value) !== 0) nonzero = true
    }
    if (!nonzero) throw new Error(`Embedding item ${index} is a zero vector.`)
  }
  return dimension
}
