import type { VectorStore, VectorRecord, VectorSearchHit, VectorSearchOptions } from './VectorStore'
import type { VectorIndexConfig } from '../../../shared/workspaceStorage'

// LanceDB-backed, block-encrypted, per-workspace vector store (ADR-0005).
//
// STATUS: scaffold. The interface, lifecycle, and encryption wiring are fixed;
// the LanceDB calls are stubbed (throw) until the dependency lands. This keeps
// the seam reviewable and the rest of the codebase compiling against the final
// shape. Implementation steps are inline as TODO(ADR-0005).
//
// Why LanceDB: it is the only truly embedded (in-process, no sidecar) vector
// DB in the Node ecosystem, its Rust core does IVF-PQ / RaBitQ at billion scale
// with ~1–5 ms latency from disk, and its on-disk format is a directory of
// columnar files per dataset — which maps one-to-one onto "one directory per
// workspace, load only the active one".
//
// Encryption: LanceDB OSS has no at-rest encryption, so we do not let it touch
// the real filesystem directly. It is pointed at a custom ObjectStore whose
// read/write go through EncryptedBlockFile (blockCipher.ts), keyed by this
// workspace's WDEK. A query touches a few blocks; only those decrypt. That is
// how we get "encrypt multiple files" + "don't decrypt the whole vault" without
// surrendering disk-ANN performance.

const NOT_IMPLEMENTED = (what: string): Error =>
  new Error(
    `LanceWorkspaceStore.${what} is not implemented yet — scaffold per ADR-0005. ` +
      `Wire @lancedb/lancedb over the encrypted ObjectStore before enabling.`,
  )

export interface LanceWorkspaceStoreOptions {
  workspaceId: number
  config: VectorIndexConfig
  /** Absolute path to this workspace's directory (holds the Lance dataset). */
  dir: string
  /** Unwrapped per-workspace data key (32 bytes, mlock'd). Used to key the
   *  EncryptedBlockFile layer beneath LanceDB. Not owned by this class — the
   *  WorkspaceStore that opened it wipes it on close. */
  wdek: Buffer
}

export class LanceWorkspaceStore implements VectorStore {
  readonly workspaceId: number
  readonly config: VectorIndexConfig

  private readonly dir: string
  private readonly wdek: Buffer
  /** Lazily-opened LanceDB table handle. Typed `unknown` until the dependency
   *  is added; the import is dynamic so this file carries no hard dep yet. */
  private table: unknown = null

  constructor(opts: LanceWorkspaceStoreOptions) {
    if (opts.wdek.length !== 32) throw new Error('LanceWorkspaceStore needs a 32-byte WDEK')
    this.workspaceId = opts.workspaceId
    this.config = opts.config
    this.dir = opts.dir
    this.wdek = opts.wdek
  }

  /**
   * Opens (or creates) the workspace's Lance dataset over the encrypted
   * ObjectStore. TODO(ADR-0005):
   *   1. const lancedb = await import('@lancedb/lancedb')
   *   2. build an ObjectStore whose get/put route through EncryptedBlockFile
   *      (blockCipher.ts) keyed by this.wdek, rooted at this.dir
   *   3. connect + openTable('vectors') | createTable with the
   *      {chunkId, documentId, vector} schema and this.config
   */
  async open(): Promise<void> {
    void this.dir
    void this.wdek
    throw NOT_IMPLEMENTED('open')
  }

  async upsert(_records: VectorRecord[]): Promise<void> {
    // TODO(ADR-0005): table.mergeInsert('chunkId').whenMatchedUpdateAll()
    //                 .whenNotMatchedInsertAll().execute(rows)
    throw NOT_IMPLEMENTED('upsert')
  }

  async remove(_chunkIds: number[]): Promise<void> {
    // TODO(ADR-0005): table.delete(`chunkId IN (${ids.join(',')})`)
    throw NOT_IMPLEMENTED('remove')
  }

  async search(
    _queryVector: number[],
    _topK: number,
    _opts?: VectorSearchOptions,
  ): Promise<VectorSearchHit[]> {
    // TODO(ADR-0005): table.search(vec).distanceType('cosine')
    //   .where(activeDocumentIds filter).refineFactor(oversample).limit(topK)
    //   then map distance -> (1 - distance) cosine similarity. Apply perDocK
    //   diversity in the caller (RetrievalService) as today.
    throw NOT_IMPLEMENTED('search')
  }

  async count(): Promise<number> {
    // TODO(ADR-0005): return table.countRows()
    throw NOT_IMPLEMENTED('count')
  }

  async buildIndex(_config?: VectorIndexConfig): Promise<void> {
    // TODO(ADR-0005): table.createIndex('vector', { config: IvfPq / RaBitQ from
    //                 this.config }) — skip when numSubVectors === 0 (flat).
    throw NOT_IMPLEMENTED('buildIndex')
  }

  async flush(): Promise<void> {
    throw NOT_IMPLEMENTED('flush')
  }

  async close(): Promise<void> {
    // Releasing the table handle is safe to call pre-open; real impl nulls it
    // and lets the ObjectStore close its EncryptedBlockFile handles.
    this.table = null
  }
}
