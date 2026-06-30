import * as lancedb from '@lancedb/lancedb'
import type { Connection, Table, VectorQuery } from '@lancedb/lancedb'
import type { VectorStore, VectorRecord, VectorSearchHit, VectorSearchOptions } from './VectorStore'
import type { VectorIndexConfig } from '../../../shared/workspaceStorage'

// LanceDB-backed per-workspace vector store (ADR-0005).
//
// Operates on a PLAINTEXT working directory — the at-rest encryption is handled
// one layer up by EncryptedWorkspaceDir (decrypt-on-open / encrypt-on-close),
// because LanceDB OSS exposes no JS hook to encrypt its own I/O (see ADR-0005 §3,
// revision). So this class is "just" the engine adapter; it never sees the WDEK.
//
// Table schema (inferred from the first insert): { chunkId int, documentId int,
// vector fixed-size-list<float32, dims> }. chunkId is the merge/delete key,
// mirroring the chunks table PK so retrieval joins back to text unchanged.

const TABLE = 'vectors'

export interface LanceWorkspaceStoreOptions {
  workspaceId: number
  config: VectorIndexConfig
  /** Plaintext directory LanceDB connects to (provided by EncryptedWorkspaceDir). */
  datasetDir: string
}

interface LanceRow {
  chunkId: number
  documentId: number
  vector: number[]
  // LanceDB's create/merge APIs take Record<string, unknown>[]; the index
  // signature makes this concrete row shape assignable to that.
  [k: string]: unknown
}

export class LanceWorkspaceStore implements VectorStore {
  readonly workspaceId: number
  readonly config: VectorIndexConfig

  private readonly datasetDir: string
  private conn: Connection | null = null
  private table: Table | null = null
  // FIFO mutex serializing mutating ops (upsert/remove) against close(). The
  // app-quit drain can fire lock() -> WorkspaceStore.close() -> this.close()
  // while a stall-bailed document is still mid-upsert; without this, close()
  // would null the table/conn out from under an in-flight mergeInsert. Chaining
  // makes close() wait for the write to finish (or vice-versa) instead of racing.
  private opChain: Promise<void> = Promise.resolve()
  // Vector dimension of the open table's fixed-size-list column, cached so the
  // hot upsert/search paths don't re-read the Arrow schema each call. null until
  // a table exists (or when the dim can't be read). Drives the dimension-change
  // rebuild — see upsert() / search() (ADR-0006: BGE-M3 1024 ↔ jina-code 896).
  private tableDim: number | null = null

  constructor(opts: LanceWorkspaceStoreOptions) {
    this.workspaceId = opts.workspaceId
    this.config = opts.config
    this.datasetDir = opts.datasetDir
  }

  /** Connects and opens the table if it already exists. A brand-new workspace
   *  has no table yet — it is created lazily on the first upsert (so the schema
   *  is inferred from real vectors). */
  async open(): Promise<void> {
    this.conn = await lancedb.connect(this.datasetDir)
    const names = await this.conn.tableNames()
    if (names.includes(TABLE)) {
      this.table = await this.conn.openTable(TABLE)
      this.tableDim = await this.readVectorDim(this.table)
    }
  }

  /** Reads the `vector` fixed-size-list dimension from a table's Arrow schema,
   *  or null when it can't be determined. */
  private async readVectorDim(table: Table): Promise<number | null> {
    try {
      const schema = await table.schema()
      const field = schema.fields.find((f) => f.name === 'vector')
      const size = (field?.type as { listSize?: number } | undefined)?.listSize
      return typeof size === 'number' && size > 0 ? size : null
    } catch {
      return null
    }
  }

  /** Runs `fn` after any in-flight write/close settles, then advances the chain.
   *  Failures don't break the chain (next op still runs). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn)
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    return this.enqueue(() => this.upsertLocked(records))
  }

  private async upsertLocked(records: VectorRecord[]): Promise<void> {
    const incomingDim = records[0]!.vector.length
    const rows: LanceRow[] = records.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      vector: r.vector,
    }))
    // Dimension change — a codebase workspace's model-swap backfill moving
    // BGE-M3 (1024) → jina-code (896), or vice versa (ADR-0006). A LanceDB
    // fixed-size-list vector column is single-dim, and any rows still present
    // are the *old* model's vectors (the backfill purges them on the stem change
    // before re-embedding), so the only correct move is to drop the table and
    // recreate it at the new dim. Without this, mergeInsert silently keeps the
    // old-dim column and a later search fails with "No vector column found to
    // match with the query vector dimension".
    if (this.table && this.tableDim !== null && this.tableDim !== incomingDim) {
      await this.requireConn().dropTable(TABLE)
      this.table = null
      this.tableDim = null
    }
    if (!this.table) {
      const conn = this.requireConn()
      // First write defines the schema (vector dim is taken from the data).
      this.table = await conn.createTable(TABLE, rows)
      this.tableDim = incomingDim
      return
    }
    await this.table
      .mergeInsert('chunkId')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows)
  }

  async remove(chunkIds: number[]): Promise<void> {
    if (chunkIds.length === 0) return
    return this.enqueue(async () => {
      if (!this.table) return
      await this.table.delete(`chunkId IN (${chunkIds.map((n) => Math.trunc(n)).join(',')})`)
    })
  }

  async search(
    queryVector: number[],
    topK: number,
    opts: VectorSearchOptions = {},
  ): Promise<VectorSearchHit[]> {
    if (!this.table || queryVector.length === 0 || topK <= 0) return []
    // Query embedder dim must match the table's vector column. They diverge for
    // a codebase workspace whose active embedder became jina-code (896) while
    // its table is still BGE-M3 (1024), in the window before the re-embed
    // backfill rebuilds it. Degrade to "no vector hits" (FTS/lexical still
    // answers via the hybrid layer) instead of throwing LanceDB's dimension
    // error up through search:hybrid (ADR-0006).
    if (this.tableDim !== null && queryVector.length !== this.tableDim) return []
    const perDocK = opts.perDocK && opts.perDocK > 0 ? opts.perDocK : null
    // Pull extra candidates when we need ANN recall headroom or have to cap per
    // document, then trim after re-grouping.
    const fetch = Math.max(topK, opts.oversample ?? topK, perDocK ? topK * 8 : 0)

    // search(vector) yields a VectorQuery; the public type unions it with Query,
    // so narrow before using the vector-only .distanceType().
    let q = (this.table.search(queryVector) as VectorQuery).distanceType('cosine')
    if (opts.activeDocumentIds && opts.activeDocumentIds.length > 0) {
      q = q.where(`documentId IN (${opts.activeDocumentIds.map((n) => Math.trunc(n)).join(',')})`)
    }
    // Request `_distance` explicitly: Lance is deprecating the auto-projection
    // that silently appends the score column when select() omits it, and we read
    // r._distance below.
    const raw = (await q
      .select(['chunkId', 'documentId', '_distance'])
      .limit(fetch)
      .toArray()) as Array<{
      chunkId: number
      documentId: number
      _distance: number
    }>

    // cosine _distance = 1 - cosine similarity → score back to [0,1] like pgvector.
    let hits: VectorSearchHit[] = raw.map((r) => ({
      chunkId: Number(r.chunkId),
      documentId: Number(r.documentId),
      score: 1 - r._distance,
    }))

    if (perDocK) {
      const perDoc = new Map<number, number>()
      hits = hits.filter((h) => {
        const n = perDoc.get(h.documentId) ?? 0
        if (n >= perDocK) return false
        perDoc.set(h.documentId, n + 1)
        return true
      })
    }
    return hits.slice(0, topK)
  }

  async count(): Promise<number> {
    if (!this.table) return 0
    return this.table.countRows()
  }

  /** Builds the ANN index. Flat (numSubVectors === 0) workspaces skip it —
   *  brute-force beats index maintenance below the threshold (suggestIndexConfig). */
  async buildIndex(config: VectorIndexConfig = this.config): Promise<void> {
    if (!this.table) return
    if ((await this.table.countRows()) === 0) return
    const index =
      config.numSubVectors > 0
        ? lancedb.Index.ivfPq({
            distanceType: 'cosine',
            numPartitions: config.numPartitions,
            numSubVectors: config.numSubVectors,
          })
        : lancedb.Index.ivfFlat({
            distanceType: 'cosine',
            numPartitions: Math.max(1, config.numPartitions),
          })
    await this.table.createIndex('vector', { config: index, replace: true })
  }

  async flush(): Promise<void> {
    // LanceDB writes are durable on execute(); compaction is a future
    // optimisation. Nothing buffered to flush at this layer.
  }

  async close(): Promise<void> {
    // Wait behind any in-flight upsert/remove so we never null the table/conn
    // out from under a running mergeInsert (the quit-drain ceiling can trigger
    // lock() -> close() while a document is still persisting its vectors).
    return this.enqueue(async () => {
      this.table = null
      this.tableDim = null
      if (this.conn) {
        this.conn.close()
        this.conn = null
      }
    })
  }

  private requireConn(): Connection {
    if (!this.conn) throw new Error('LanceWorkspaceStore.open() not called')
    return this.conn
  }
}
