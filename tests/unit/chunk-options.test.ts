import { describe, it, expect } from 'vitest'
import { resolveChunkOptions } from '@main/services/documents/chunkOptions'

// AP-9 §3.8 "Chunkgröße / Überlappung": the indexing sliders must drive how
// documents are chunked. Precedence: an explicit per-import value (rare — e.g.
// a future re-index-with-override) wins; otherwise the user's configured
// retrieval defaults apply; if neither is set the chunker falls back to its own
// DEFAULT (so the resolved value stays undefined).
describe('resolveChunkOptions', () => {
  it('uses the configured retrieval defaults when the import pins nothing', () => {
    expect(resolveChunkOptions({}, { chunkSize: 3000, chunkOverlap: 150 })).toEqual({
      chunkSize: 3000,
      chunkOverlap: 150,
    })
  })

  it('lets an explicit per-import value win over the configured default', () => {
    expect(resolveChunkOptions({ chunkSize: 500 }, { chunkSize: 2000, chunkOverlap: 200 })).toEqual(
      {
        chunkSize: 500,
        chunkOverlap: 200,
      },
    )
  })

  it('leaves values undefined when neither import nor settings set them', () => {
    expect(resolveChunkOptions({}, undefined)).toEqual({
      chunkSize: undefined,
      chunkOverlap: undefined,
    })
  })
})
