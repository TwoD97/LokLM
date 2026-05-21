// Pure helper: converts the eval-side ranked chunks into the RetrievalHit
// shape the LlamaService.ask() expects. Lives in its own file so the sweep
// runner can import it without dragging in the LlmBridge (which transitively
// imports electron-only modules via src/main/services/models/paths.ts).

import type { RetrievalHit } from '../../../src/main/services/retrieval/RetrievalService'

/**
 * Convert ranked eval-chunks into RetrievalHit shape. The eval pipeline
 * doesn't carry document metadata (no real docs, just synth chunks), so
 * we fabricate stable placeholder fields — chunk_id from a string hash,
 * document_title from docId.
 */
export function evalChunksToHits(
  ranked: ReadonlyArray<{ id: string; docId: string; text: string; score: number }>,
): RetrievalHit[] {
  return ranked.map((c, i) => ({
    chunk_id: hashToInt(c.id),
    document_id: hashToInt(c.docId),
    document_title: c.docId,
    ordinal: i,
    page_from: null,
    page_to: null,
    heading_path: null,
    text: c.text,
    score: c.score,
    origin: 'primary' as const,
  }))
}

function hashToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}
