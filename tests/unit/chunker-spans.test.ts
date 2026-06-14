import { describe, it, expect } from 'vitest'
import { FixedSizeChunker } from '../evals/pipeline/Chunker'

describe('FixedSizeChunker char offsets', () => {
  it('emits start/end windows with overlap step', () => {
    const text = 'x'.repeat(1000)
    const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
    const chunks = chunker.chunk({ id: 'doc', text })
    // step = size - overlap = 448 → starts at 0, 448, 896
    expect(chunks.map((c) => c.start)).toEqual([0, 448, 896])
    expect(chunks.map((c) => c.end)).toEqual([512, 960, 1000])
    expect(chunks[0]!.id).toBe('doc::0')
  })

  it('clamps the final window end to the document length', () => {
    const text = 'y'.repeat(500)
    const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
    const chunks = chunker.chunk({ id: 'doc', text })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.start).toBe(0)
    expect(chunks[0]!.end).toBe(500)
  })
})
