import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { eq, desc, sql } from 'drizzle-orm'
import * as schema from './schema'
import { documents, chunks, workspaces } from './schema'
import type { Document, NewDocument, NewChunk, Workspace } from './schema'

// PgliteDatabase intersected with $client so migrate.ts can call client.exec()
// for multi-statement SQL (drizzle's db.execute goes through prepared statements
// and cannot handle multiple commands in one string).
export type Db = PgliteDatabase<typeof schema> & { $client: PGlite }

/**
 * owns the PGlite + Drizzle pair for one unlocked session.
 *
 * the DB is in-memory because durable persistence is the encrypted snapshot
 * inside the vault file , not a directory on disk. on login the snapshot is
 * decrypted , fed into `loadDataDir` , and PGlite picks up where the previous
 * session left off. on lock/logout AuthService calls `dump()` , encrypts the
 * result , and writes it back.
 *
 * no drizzle migrations run here yet , the schema is empty. auth metadata
 * lives in the vault header , not in SQL. when real app tables land , wire
 * `migrate()` back in and ship the migrations folder via extraResources.
 */
export class Database {
  private constructor(
    private readonly client: PGlite,
    private readonly drizzleDb: Db,
  ) {}

  /**
   * creates an in-memory PGlite instance. if `loadFromBlob` is provided , the
   * blob (a previous `dump()` output) seeds the data directory.
   *
   * @param _dataDir reserved , pass `undefined` (in-memory is the only mode we support)
   * @param loadFromBlob optional snapshot blob from a previous `dump()`
   */
  static async create(_dataDir: string | undefined, loadFromBlob?: Blob): Promise<Database> {
    const client = loadFromBlob
      ? new PGlite({ loadDataDir: loadFromBlob, extensions: { vector } })
      : new PGlite({ extensions: { vector } })
    await client.waitReady
    const drizzleDb = drizzle(client, { schema })
    const { runMigrations } = await import('./migrate')
    await runMigrations(drizzleDb)
    return new Database(client, drizzleDb)
  }

  /** serialises the live DB to a tar Blob , ready for AES-GCM encryption. */
  async dump(): Promise<Blob> {
    return this.client.dumpDataDir()
  }

  async close(): Promise<void> {
    await this.client.close()
  }

  /** Drizzle handle for services that need to run queries. */
  get db(): Db {
    return this.drizzleDb
  }

  documents(): DocumentsRepo {
    return new DocumentsRepo(this.db)
  }

  workspaces(): WorkspacesRepo {
    return new WorkspacesRepo(this.db)
  }
}

export { schema }

// ----- repos ---------------------------------------------------------------

// loose db handle so tx tests can pass a transaction object directly. drizzle's
// tx and Db share the same select/insert/update/delete/execute surface but are
// not the same nominal type.
type DbHandle = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export interface NewChunkInput {
  ordinal: number
  text: string
  pageFrom: number
  pageTo: number
  tokenCount: number
}

export interface ChunkRow {
  id: number
  document_id: number
  ordinal: number
  text: string
  token_count: number | null
  page_from: number | null
  page_to: number | null
}

export interface SearchHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  text: string
  score: number
  added_at?: number | null
}

export interface ChunkSearchOptions {
  /** When non-empty, retrieval is constrained to this document_id set.
   *  Empty/null = workspace-wide. NotebookLM-style focus. */
  activeDocumentIds?: number[] | null
  /** Cap each document at this many chunks in the candidate pool via
   *  ROW_NUMBER(). Stops content-dense docs from monopolising the pool. */
  perDocK?: number
}

export class DocumentsRepo {
  constructor(private readonly db: DbHandle) {}

  async addDocument(
    input: Pick<NewDocument, 'workspaceId' | 'title' | 'sourcePath' | 'mimeType' | 'byteSize'>,
  ): Promise<Document> {
    const [row] = await this.db.insert(documents).values(input).returning()
    return row!
  }

  async setDocumentStatus(documentId: number, status: string): Promise<void> {
    await this.db.update(documents).set({ status }).where(eq(documents.id, documentId))
  }

  async listDocumentsByWorkspace(workspaceId: number): Promise<Document[]> {
    return this.db
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId))
      .orderBy(desc(documents.addedAt))
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [row] = await this.db.select().from(documents).where(eq(documents.id, id))
    return row
  }

  async deleteDocument(id: number): Promise<void> {
    await this.db.delete(documents).where(eq(documents.id, id))
  }

  async reindexDocument(id: number): Promise<void> {
    await this.db.execute(sql`CALL reindex_document(${id})`)
  }

  async persistChunks(documentId: number, items: NewChunkInput[]): Promise<void> {
    if (items.length === 0) return
    const rows: NewChunk[] = items.map((c) => ({
      documentId,
      ordinal: c.ordinal,
      text: c.text,
      pageFrom: c.pageFrom,
      pageTo: c.pageTo,
      tokenCount: c.tokenCount,
    }))
    await this.db.insert(chunks).values(rows)
  }

  async countChunksMissingEmbedding(workspaceId: number): Promise<number> {
    const r = await this.db.execute(sql`
      SELECT count(*)::int AS n
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
       WHERE d.workspace_id = ${workspaceId} AND c.embedding IS NULL
    `)
    return (r.rows as { n: number }[])[0]?.n ?? 0
  }

  async listChunksMissingEmbedding(
    workspaceId: number,
    limit: number,
  ): Promise<Array<{ id: number; text: string }>> {
    const r = await this.db.execute(sql`
      SELECT c.id, c.text
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
       WHERE d.workspace_id = ${workspaceId} AND c.embedding IS NULL
       ORDER BY c.id
       LIMIT ${limit}
    `)
    return r.rows as Array<{ id: number; text: string }>
  }

  async setChunkEmbedding(chunkId: number, vector: number[]): Promise<void> {
    const lit = '[' + vector.join(',') + ']'
    await this.db.execute(sql`UPDATE chunks SET embedding = ${lit}::vector WHERE id = ${chunkId}`)
  }

  async ensureVectorIndex(): Promise<void> {
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_chunks_hnsw
        ON chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `)
  }

  async searchChunks(
    workspaceId: number,
    query: string,
    topK: number,
    opts: ChunkSearchOptions = {},
  ): Promise<SearchHit[]> {
    const cleaned = query.trim()
    if (!cleaned) return []
    const activeIds =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0 ? opts.activeDocumentIds : null
    const perDocK = opts.perDocK && opts.perDocK > 0 ? opts.perDocK : null
    const activeLit = activeIds == null ? null : '{' + activeIds.join(',') + '}'

    // plainto_tsquery → AND-of-terms is too strict on natural queries; the
    // '&' → '|' replace turns it into OR so common words don't kill the
    // match set. ts_rank_cd already rewards chunks that hit more terms, so
    // OR + rank gives recall + ordering. Bilingual: union the german and
    // english queries.
    const r = await this.db.execute(sql`
      WITH q AS (
        SELECT
          NULLIF(replace(plainto_tsquery('german',  ${cleaned})::text, '&', '|'), '')::tsquery AS qg,
          NULLIF(replace(plainto_tsquery('english', ${cleaned})::text, '&', '|'), '')::tsquery AS qe
      ),
      qq AS (
        SELECT COALESCE(qg, ''::tsquery) || COALESCE(qe, ''::tsquery) AS query FROM q
      ),
      hits AS (
        SELECT
          c.id          AS chunk_id,
          c.document_id AS document_id,
          d.title       AS document_title,
          c.ordinal     AS ordinal,
          c.page_from   AS page_from,
          c.page_to     AS page_to,
          c.text        AS text,
          ts_rank_cd(c.text_search, qq.query) AS score,
          d.added_at    AS added_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        CROSS JOIN qq
        WHERE qq.query::text <> ''
          AND c.text_search @@ qq.query
          AND d.workspace_id = ${workspaceId}
          AND d.status = 'ready'
          AND (${activeLit}::int[] IS NULL OR c.document_id = ANY(${activeLit}::int[]))
      ),
      ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY document_id
                 ORDER BY score DESC
               ) AS doc_rank
          FROM hits
      )
      SELECT chunk_id, document_id, document_title, ordinal,
             page_from, page_to, text, score, added_at
        FROM ranked
       WHERE ${perDocK}::int IS NULL OR doc_rank <= ${perDocK}::int
       ORDER BY score DESC
       LIMIT ${topK}
    `)
    return r.rows as unknown as SearchHit[]
  }

  async searchChunksByVector(
    workspaceId: number,
    embedding: number[],
    topK: number,
    opts: ChunkSearchOptions = {},
  ): Promise<SearchHit[]> {
    if (embedding.length === 0) return []
    const lit = '[' + embedding.join(',') + ']'
    const activeIds =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0 ? opts.activeDocumentIds : null
    const perDocK = opts.perDocK && opts.perDocK > 0 ? opts.perDocK : null
    const activeLit = activeIds == null ? null : '{' + activeIds.join(',') + '}'

    if (perDocK === null && activeIds === null) {
      // fast path — HNSW drives ORDER BY + LIMIT directly
      const r = await this.db.execute(sql`
        SELECT
          c.id          AS chunk_id,
          c.document_id AS document_id,
          d.title       AS document_title,
          c.ordinal     AS ordinal,
          c.page_from   AS page_from,
          c.page_to     AS page_to,
          c.text        AS text,
          (1 - (c.embedding <=> ${lit}::vector))::FLOAT AS score,
          d.added_at    AS added_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL
          AND d.workspace_id = ${workspaceId}
          AND d.status = 'ready'
        ORDER BY c.embedding <=> ${lit}::vector ASC
        LIMIT ${topK}
      `)
      return r.rows as unknown as SearchHit[]
    }

    // per-doc cap branch — window-fn defeats the HNSW plan but enforces fairness
    const r = await this.db.execute(sql`
      WITH ranked AS (
        SELECT
          c.id          AS chunk_id,
          c.document_id AS document_id,
          d.title       AS document_title,
          c.ordinal     AS ordinal,
          c.page_from   AS page_from,
          c.page_to     AS page_to,
          c.text        AS text,
          (1 - (c.embedding <=> ${lit}::vector))::FLOAT AS score,
          d.added_at    AS added_at,
          ROW_NUMBER() OVER (
            PARTITION BY c.document_id
            ORDER BY c.embedding <=> ${lit}::vector ASC
          ) AS doc_rank
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL
          AND d.workspace_id = ${workspaceId}
          AND d.status = 'ready'
          AND (${activeLit}::int[] IS NULL OR c.document_id = ANY(${activeLit}::int[]))
      )
      SELECT chunk_id, document_id, document_title, ordinal,
             page_from, page_to, text, score, added_at
        FROM ranked
       WHERE ${perDocK}::int IS NULL OR doc_rank <= ${perDocK}::int
       ORDER BY score DESC
       LIMIT ${topK}
    `)
    return r.rows as unknown as SearchHit[]
  }

  async listChunksForDocument(documentId: number): Promise<ChunkRow[]> {
    const r = await this.db.execute(sql`
      SELECT id, document_id, ordinal, text, token_count, page_from, page_to
        FROM chunks
       WHERE document_id = ${documentId}
       ORDER BY ordinal
    `)
    return r.rows as unknown as ChunkRow[]
  }

  /**
   * Returns a Map<document_id, chunk_count> for the given document ids.
   * Used by RetrievalService.expandSmallDocs to decide whether a document
   * qualifies for whole-doc expansion.
   */
  async getChunkCounts(documentIds: number[]): Promise<Map<number, number>> {
    if (documentIds.length === 0) return new Map()
    const lit = '{' + documentIds.join(',') + '}'
    const r = await this.db.execute(sql`
      SELECT document_id, count(*)::int AS cnt
        FROM chunks
       WHERE document_id = ANY(${lit}::int[])
       GROUP BY document_id
    `)
    const map = new Map<number, number>()
    for (const row of r.rows as Array<{ document_id: number; cnt: number }>) {
      map.set(row.document_id, row.cnt)
    }
    return map
  }

  /**
   * Returns neighbour chunks within ±radius ordinals of each seed position.
   * Seeds are (documentId, ordinal) pairs. Results are ordered by
   * document_id, ordinal so the caller can interleave them adjacently.
   * Used by RetrievalService.expandNeighbours.
   */
  async getNeighbourChunks(
    seeds: Array<{ documentId: number; ordinal: number }>,
    radius: number,
  ): Promise<ChunkRow[]> {
    if (seeds.length === 0 || radius <= 0) return []
    // Build a VALUES list so we can join in a single query rather than N
    // individual round-trips. Each seed becomes (document_id, ordinal).
    const valueParts = seeds.map((s) => `(${s.documentId}, ${s.ordinal})`).join(', ')
    const r = await this.db.execute(sql`
      WITH seeds(doc_id, ord) AS (
        VALUES ${sql.raw(valueParts)}
      )
      SELECT DISTINCT c.id, c.document_id, c.ordinal, c.text,
                      c.token_count, c.page_from, c.page_to
        FROM chunks c
        JOIN seeds s ON c.document_id = s.doc_id
       WHERE c.ordinal BETWEEN s.ord - ${radius} AND s.ord + ${radius}
       ORDER BY c.document_id, c.ordinal
    `)
    return r.rows as unknown as ChunkRow[]
  }
}

export class WorkspacesRepo {
  constructor(private readonly db: DbHandle) {}

  async list(): Promise<Workspace[]> {
    return this.db.select().from(workspaces).orderBy(desc(workspaces.createdAt))
  }

  async create(name: string): Promise<Workspace> {
    const [row] = await this.db.insert(workspaces).values({ name }).returning()
    return row!
  }

  async rename(id: number, name: string): Promise<void> {
    await this.db.update(workspaces).set({ name }).where(eq(workspaces.id, id))
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(workspaces).where(eq(workspaces.id, id))
  }
}
