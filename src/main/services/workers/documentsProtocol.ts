// Wire protocol between main and the documentsWorker utilityProcess. Document
// parsing (pdf-parse / mammoth), OCR (tesseract.js + canvas rasterisation) and
// the section-aware chunker all run there so a book-length or scanned PDF never
// pins the main event loop — and, unlike the old design, never competes with
// the models worker that streams chat tokens.
//
// Conventions mirror the models worker: every request carries a numeric `id`
// and gets exactly one response; push events (no id) carry OCR progress + logs.

export interface ParseAndChunkPayload {
  sourcePath: string
  /** Echoed back in `ocr` progress pushes so the main side can map progress to
   *  the right document's indexing:progress stream. */
  documentId?: number
  chunkSize?: number
  chunkOverlap?: number
}

/** Chunks ready for persistChunks. The worker handles parse + OCR + chunker +
 *  PDF-outline overlay + per-chunk language tagging (eld) end to end. */
export interface ParseAndChunkResult {
  chunks: Array<{
    ordinal: number
    text: string
    pageFrom: number | null
    pageTo: number | null
    headingPath: string[] | null
    language: 'de' | 'en' | 'other' | null
  }>
}

// ---- requests : main → worker ---------------------------------------------

export type DocWorkerRequest =
  | { id: number; op: 'documents.parseAndChunk'; payload: ParseAndChunkPayload }
  | { id: number; op: 'shutdown' }

// ---- responses : worker → main (paired by id) -----------------------------

export type DocWorkerResponse<T = unknown> =
  | { id: number; ok: true; result: T }
  | { id: number; ok: false; error: string }

// ---- push events : worker → main (no id, fire-and-forget) -----------------

export type DocWorkerPush =
  | { ev: 'ocr'; documentId: number | null; done: number; total: number }
  | { ev: 'log'; level: 'info' | 'warn' | 'error'; message: string }

export type DocWorkerMessage = DocWorkerResponse | DocWorkerPush
