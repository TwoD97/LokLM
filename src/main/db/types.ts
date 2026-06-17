// Shared row/option shapes for the retrieval + document read paths. These were
// originally exported from the PGlite `db/database.ts`; they're pure types (no
// engine dependency) so they live here now that the app reads from the
// per-workspace SQLite + LanceDB stores (ADR-0005). The snake_case fields mirror
// the SQL projections the WorkspaceDb queries return.

export interface ChunkRow {
  id: number
  document_id: number
  ordinal: number
  text: string
  token_count: number | null
  page_from: number | null
  page_to: number | null
  heading_path: string[] | null
  language: 'de' | 'en' | 'other' | null
}

export interface SearchHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  heading_path: string[] | null
  text: string
  score: number
  added_at?: number | null
  language: 'de' | 'en' | 'other' | null
}

export interface ChunkSearchOptions {
  /** When non-empty, retrieval is constrained to this document_id set.
   *  Empty/null = workspace-wide. NotebookLM-style focus. */
  activeDocumentIds?: number[] | null
  /** Cap each document at this many chunks in the candidate pool via
   *  ROW_NUMBER(). Stops content-dense docs from monopolising the pool. */
  perDocK?: number
}

/** Raw row shape of the library search (AP-6). snake_case mirrors the SQL
 *  projection; the IPC handler maps it to the camelCase LibrarySearchHit and
 *  splits `headline`'s ⟦⟧ sentinels into segments. */
export interface LibrarySearchRow {
  chunk_id: number
  document_id: number
  document_title: string
  doc_type: string
  page_from: number | null
  page_to: number | null
  heading_path: string[] | null
  score: number
  added_at: number | null
  byte_size: number | null
  language: 'de' | 'en' | 'other' | null
  /** Excerpt with ⟦…⟧ around matched terms (prefix-fallback when empty). */
  headline: string
}
