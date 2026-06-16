import type { VectorIndexConfig } from '../../../shared/workspaceStorage'

// The vector-store seam (ADR-0005).
//
// Today retrieval calls Database.searchChunksByVector(), which runs pgvector
// inside the in-memory PGlite instance. That cannot reach 100–500 M vectors:
// PGlite holds the whole DB in the WASM heap, and the vault is decrypted into
// memory in full on unlock. This interface is the boundary we retarget at a
// disk-resident, per-workspace engine (LanceDB, ADR-0005) without the retrieval
// pipeline above it caring which backend answers.
//
// One VectorStore instance == one workspace's index. It is opened against an
// already-unwrapped workspace key (WDEK) and its files are block-encrypted
// (see blockCipher / LanceWorkspaceStore). Only the active workspace's store is
// open at a time, so resident memory tracks the largest single workspace, not
// the whole corpus — which is the entire reason per-workspace loading scales.

/** A single vector + the identifiers retrieval needs to join back to chunk
 *  text. Mirrors the chunk identity already used by SearchHit so the retrieval
 *  layer maps results with no shape change. */
export interface VectorRecord {
  chunkId: number
  documentId: number
  /** Cosine-normalised embedding, length === indexConfig.dims. */
  vector: number[]
}

export interface VectorSearchOptions {
  /** Constrain to this document set (NotebookLM-style focus). Empty/undefined =
   *  workspace-wide. Pushed down to the engine as a pre-filter. */
  activeDocumentIds?: number[]
  /** Cap per document in the candidate pool, for source diversity. */
  perDocK?: number
  /** Candidates to pull from the ANN index before rescoring/rerank. Higher =
   *  better recall, more work. Defaults chosen per index size by the impl. */
  oversample?: number
}

export interface VectorSearchHit {
  chunkId: number
  documentId: number
  /** Cosine similarity in [0,1], already converted from engine distance. */
  score: number
}

/**
 * Backend-agnostic per-workspace vector index. Implementations: PGliteVector
 * store (adapter over today's searchChunksByVector, for migration + small
 * workspaces) and LanceWorkspaceStore (the scaled, encrypted backend).
 */
export interface VectorStore {
  readonly workspaceId: number
  readonly config: VectorIndexConfig

  /** Insert or replace vectors by chunkId. Batched; callers feed embeddings in
   *  chunks to bound memory. */
  upsert(records: VectorRecord[]): Promise<void>

  /** Remove vectors by chunkId (e.g. document deletion / reindex). */
  remove(chunkIds: number[]): Promise<void>

  /** ANN search. Returns at most `topK` hits, highest score first. */
  search(
    queryVector: number[],
    topK: number,
    opts?: VectorSearchOptions,
  ): Promise<VectorSearchHit[]>

  /** Total vectors currently indexed. */
  count(): Promise<number>

  /** (Re)build the ANN index — call after a large bulk load. Cheap/no-op for
   *  flat (small) stores. */
  buildIndex(config?: VectorIndexConfig): Promise<void>

  /** Flush pending writes durably. */
  flush(): Promise<void>

  /** Release file handles / mapped memory. Idempotent. */
  close(): Promise<void>
}
