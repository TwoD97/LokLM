import { describe, it, expect } from 'vitest'
import {
  estimateWorkspaceFootprint,
  estimatedBytesPerVector,
  DECRYPT_THROUGHPUT_BYTES_PER_SEC,
} from '@shared/workspaceStorage'

describe('estimatedBytesPerVector', () => {
  it('matches the measured ~4448 B for a 1024-dim float32 vector', () => {
    // 1024×4 raw + 352 B overhead (IVF-PQ codes + ids + manifest), from the
    // storage-scale stress test (tests/evals/scale, 2026-06-23).
    expect(estimatedBytesPerVector(1024)).toBe(4448)
    expect(estimatedBytesPerVector(896)).toBe(896 * 4 + 352)
  })
})

describe('estimateWorkspaceFootprint', () => {
  it('uses measured enc/ bytes when provided and derives open-size + open-time', () => {
    const f = estimateWorkspaceFootprint({
      workspaceId: 1,
      vectorBytes: 1_000_000_000, // measured enc/ (1 GB of vectors)
      metaDbBytes: 200_000_000, // measured meta.db (200 MB of text+FTS)
      vectorCount: 250_000,
      dims: 1024,
    })
    expect(f.measured).toBe(true)
    expect(f.vectorBytes).toBe(1_000_000_000)
    expect(f.atRestBytes).toBe(1_200_000_000)
    // Only the vector store doubles while open; meta.db (SQLCipher) does not.
    expect(f.openBytes).toBe(2_200_000_000)
    expect(f.openBytes - f.atRestBytes).toBe(f.vectorBytes)
    // 1 GB ÷ 163 MB/s ≈ 6135 ms.
    expect(f.estDecryptOnOpenMs).toBeCloseTo(
      (1_000_000_000 / DECRYPT_THROUGHPUT_BYTES_PER_SEC) * 1000,
      3,
    )
    expect(f.estDecryptOnOpenMs).toBeGreaterThan(6000)
    expect(f.estDecryptOnOpenMs).toBeLessThan(6300)
  })

  it('estimates vector bytes from the count when enc/ is not yet persisted', () => {
    const f = estimateWorkspaceFootprint({
      workspaceId: 2,
      vectorBytes: null,
      metaDbBytes: 0,
      vectorCount: 1000,
      dims: 1024,
    })
    expect(f.measured).toBe(false)
    expect(f.vectorBytes).toBe(1000 * 4448)
    expect(f.atRestBytes).toBe(1000 * 4448)
  })

  it('treats zero enc/ bytes as not-measured (falls back to the count estimate)', () => {
    const f = estimateWorkspaceFootprint({
      workspaceId: 3,
      vectorBytes: 0,
      metaDbBytes: 0,
      vectorCount: 0,
      dims: 1024,
    })
    expect(f.measured).toBe(false)
    expect(f.vectorBytes).toBe(0)
    expect(f.atRestBytes).toBe(0)
    expect(f.openBytes).toBe(0)
    expect(f.estDecryptOnOpenMs).toBe(0)
  })
})
