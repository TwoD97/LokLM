import type { SourceChunk } from '../synth/QuestionGenerator'

// chunker , teilt ein dokument in retrievable chunks.
// fixed-size + overlap ist die einfachste impl. semantic chunking kommt als
// eigene impl daneben sobald wir das wirklich nutzen.

export interface ChunkerConfig {
  name: string
  /** approx tokens pro chunk (hier vereinfacht als zeichenfenster) */
  size: number
  /** überlappung in selben einheiten */
  overlap: number
}

export interface Chunker {
  readonly name: string
  chunk(doc: { id: string; text: string }): SourceChunk[]
}

export class FixedSizeChunker implements Chunker {
  readonly name: string
  constructor(private readonly cfg: ChunkerConfig) {
    this.name = cfg.name
  }

  chunk(doc: { id: string; text: string }): SourceChunk[] {
    const { size, overlap } = this.cfg
    if (size <= overlap) throw new Error('chunk size muss > overlap sein')
    const step = size - overlap
    const out: SourceChunk[] = []
    for (let start = 0, i = 0; start < doc.text.length; start += step, i++) {
      const slice = doc.text.slice(start, start + size).trim()
      if (slice.length === 0) continue
      out.push({ id: `${doc.id}::${i}`, docId: doc.id, text: slice })
    }
    return out
  }
}
