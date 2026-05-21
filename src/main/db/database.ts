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

  conversations(): ConversationsRepo {
    return new ConversationsRepo(this.db)
  }

  quizzes(): QuizzesRepo {
    return new QuizzesRepo(this.db)
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
  /** PDFs set this to the source page; markdown chunks leave it null. */
  pageFrom: number | null
  pageTo: number | null
  tokenCount: number
  /** Markdown sections store their breadcrumb here (["1. Intro", "Why MD"]).
   *  PDFs and unstructured text leave this null. */
  headingPath?: string[] | null
}

export interface ChunkRow {
  id: number
  document_id: number
  ordinal: number
  text: string
  token_count: number | null
  page_from: number | null
  page_to: number | null
  heading_path: string[] | null
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

  async getDocumentByChunkId(chunkId: number): Promise<Document | undefined> {
    const [row] = await this.db
      .select()
      .from(documents)
      .innerJoin(chunks, eq(chunks.documentId, documents.id))
      .where(eq(chunks.id, chunkId))
      .limit(1)
    return row?.documents
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
      headingPath: c.headingPath ?? null,
    }))
    await this.db.insert(chunks).values(rows)
  }

  /** Fetch just the heading_path for a chunk — used by the source viewer to
   *  render markdown citations as breadcrumbs. */
  async getChunkHeadingPath(chunkId: number): Promise<string[] | null> {
    const r = await this.db.execute(sql`
      SELECT heading_path FROM chunks WHERE id = ${chunkId} LIMIT 1
    `)
    const row = (r.rows as Array<{ heading_path: string[] | null }>)[0]
    return row?.heading_path ?? null
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

  async setChunkEmbedding(chunkId: number, vector: number[], identity: string): Promise<void> {
    const lit = '[' + vector.join(',') + ']'
    await this.db.execute(sql`
      UPDATE chunks
         SET embedding = ${lit}::vector, embedder_identity = ${identity}
       WHERE id = ${chunkId}
    `)
  }

  /** Nulls out the embedding for every chunk whose stored identity differs from `keep`. */
  async purgeEmbeddingsNotMatching(workspaceId: number, keep: string): Promise<number> {
    const r = await this.db.execute(sql`
      UPDATE chunks SET embedding = NULL
       WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = ${workspaceId})
         AND embedder_identity <> ${keep}
      RETURNING id
    `)
    return r.rows.length
  }

  /** Distinct embedder identities present in non-null chunk embeddings for the
   *  workspace. Used by the backfill to decide whether existing vectors are
   *  stem-compatible with the active embedder — see embedderModelStem(). */
  async distinctEmbedderIdentities(workspaceId: number): Promise<string[]> {
    const r = await this.db.execute(sql`
      SELECT DISTINCT embedder_identity
        FROM chunks
       WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = ${workspaceId})
         AND embedding IS NOT NULL
    `)
    return (r.rows as Array<{ embedder_identity: string }>).map((row) => row.embedder_identity)
  }

  /** Nulls out the embedding for chunks tagged with this exact identity. */
  async purgeEmbeddingsByIdentity(workspaceId: number, identity: string): Promise<number> {
    const r = await this.db.execute(sql`
      UPDATE chunks SET embedding = NULL
       WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = ${workspaceId})
         AND embedder_identity = ${identity}
      RETURNING id
    `)
    return r.rows.length
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
          c.id           AS chunk_id,
          c.document_id  AS document_id,
          d.title        AS document_title,
          c.ordinal      AS ordinal,
          c.page_from    AS page_from,
          c.page_to      AS page_to,
          c.heading_path AS heading_path,
          c.text         AS text,
          ts_rank_cd(c.text_search, qq.query) AS score,
          d.added_at     AS added_at
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
             page_from, page_to, heading_path, text, score, added_at
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
          c.id           AS chunk_id,
          c.document_id  AS document_id,
          d.title        AS document_title,
          c.ordinal      AS ordinal,
          c.page_from    AS page_from,
          c.page_to      AS page_to,
          c.heading_path AS heading_path,
          c.text         AS text,
          (1 - (c.embedding <=> ${lit}::vector))::FLOAT AS score,
          d.added_at     AS added_at
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
          c.id           AS chunk_id,
          c.document_id  AS document_id,
          d.title        AS document_title,
          c.ordinal      AS ordinal,
          c.page_from    AS page_from,
          c.page_to      AS page_to,
          c.heading_path AS heading_path,
          c.text         AS text,
          (1 - (c.embedding <=> ${lit}::vector))::FLOAT AS score,
          d.added_at     AS added_at,
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
             page_from, page_to, heading_path, text, score, added_at
        FROM ranked
       WHERE ${perDocK}::int IS NULL OR doc_rank <= ${perDocK}::int
       ORDER BY score DESC
       LIMIT ${topK}
    `)
    return r.rows as unknown as SearchHit[]
  }

  async getChunkWithContext(
    chunkId: number,
    before: number,
    after: number,
  ): Promise<
    Array<{
      id: number
      documentId: number
      ordinal: number
      text: string
      tokenCount: number | null
      pageFrom: number | null
      pageTo: number | null
      isTarget: boolean
    }>
  > {
    const r = await this.db.execute(sql`
      SELECT id, document_id, ordinal, text, token_count, page_from, page_to, is_target
        FROM get_chunk_with_context(${chunkId}, ${before}, ${after})
    `)
    return (
      r.rows as Array<{
        id: number
        document_id: number
        ordinal: number
        text: string
        token_count: number | null
        page_from: number | null
        page_to: number | null
        is_target: boolean
      }>
    ).map((row) => ({
      id: row.id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      text: row.text,
      tokenCount: row.token_count,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      isTarget: row.is_target,
    }))
  }

  async listChunksForDocument(documentId: number): Promise<ChunkRow[]> {
    const r = await this.db.execute(sql`
      SELECT id, document_id, ordinal, text, token_count, page_from, page_to, heading_path
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
                      c.token_count, c.page_from, c.page_to, c.heading_path
        FROM chunks c
        JOIN seeds s ON c.document_id = s.doc_id
       WHERE c.ordinal BETWEEN s.ord - ${radius} AND s.ord + ${radius}
       ORDER BY c.document_id, c.ordinal
    `)
    return r.rows as unknown as ChunkRow[]
  }
}

export interface PersistCitationInput {
  doc_id: number
  chunk_id: number
  score?: number | null
}

export class ConversationsRepo {
  constructor(private readonly db: DbHandle) {}

  async create(
    workspaceId: number,
    title?: string | null,
    activeDocumentIds?: number[],
  ): Promise<{
    id: number
    workspaceId: number
    title: string | null
    activeDocumentIds: number[]
    createdAt: number
    lastActivityAt: number
    messageCount: number
  }> {
    // `active_document_ids` is a jsonb column; drizzle's sql tag binds JS
    // arrays as Postgres arrays, which is wrong both shape- and syntax-wise
    // (empty array becomes `()`). Serialize and cast explicitly.
    const idsJson = JSON.stringify(activeDocumentIds ?? [])
    const inserted = await this.db.execute(sql`
      INSERT INTO conversations (workspace_id, title, active_document_ids)
      VALUES (${workspaceId}, ${title ?? null}, ${idsJson}::jsonb)
      RETURNING id, workspace_id, title, active_document_ids, created_at
    `)
    const row = (
      inserted.rows as unknown as Array<{
        id: number
        workspace_id: number
        title: string | null
        active_document_ids: number[] | null
        created_at: number
      }>
    )[0]!
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      activeDocumentIds: row.active_document_ids ?? [],
      createdAt: row.created_at,
      lastActivityAt: row.created_at,
      messageCount: 0,
    }
  }

  /** Idempotent title-set. The caller decides whether to skip when a title is
   *  already present (auto-naming does, manual rename wouldn't). */
  async setTitle(id: number, title: string | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE conversations SET title = ${title} WHERE id = ${id}
    `)
  }

  async setActiveDocumentIds(conversationId: number, ids: number[]): Promise<void> {
    const idsJson = JSON.stringify(ids)
    await this.db.execute(sql`
      UPDATE conversations
         SET active_document_ids = ${idsJson}::jsonb
       WHERE id = ${conversationId}
    `)
  }

  async list(workspaceId: number): Promise<
    Array<{
      id: number
      workspaceId: number
      title: string | null
      activeDocumentIds: number[]
      createdAt: number
      lastActivityAt: number
      messageCount: number
    }>
  > {
    const r = await this.db.execute(sql`
      SELECT c.id, c.workspace_id, c.title, c.active_document_ids, c.created_at,
             COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
             COUNT(m.id)::INT AS message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.workspace_id = ${workspaceId}
       GROUP BY c.id
       ORDER BY last_activity_at DESC, c.id DESC
    `)
    return (
      r.rows as unknown as Array<{
        id: number
        workspace_id: number
        title: string | null
        active_document_ids: number[] | null
        created_at: number
        last_activity_at: number
        message_count: number
      }>
    ).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      activeDocumentIds: row.active_document_ids ?? [],
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      messageCount: row.message_count,
    }))
  }

  async delete(id: number): Promise<void> {
    await this.db.execute(sql`DELETE FROM conversations WHERE id = ${id}`)
  }

  async appendMessage(
    conversationId: number,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metrics?: { ttftMs: number | null; tokensPerSec: number | null; tokenCount: number | null },
  ): Promise<{
    id: number
    conversationId: number
    role: 'user' | 'assistant' | 'system'
    content: string
    createdAt: number
    ttftMs: number | null
    tokensPerSec: number | null
    tokenCount: number | null
  }> {
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      throw new Error(`appendMessage: invalid role "${role}"`)
    }
    const ttftMs = metrics?.ttftMs ?? null
    const tokensPerSec = metrics?.tokensPerSec ?? null
    const tokenCount = metrics?.tokenCount ?? null
    const r = await this.db.execute(sql`
      INSERT INTO messages (conversation_id, role, content, ttft_ms, tokens_per_sec, token_count)
      VALUES (${conversationId}, ${role}, ${content}, ${ttftMs}, ${tokensPerSec}, ${tokenCount})
      RETURNING id, conversation_id, role, content, created_at, ttft_ms, tokens_per_sec, token_count
    `)
    const row = (
      r.rows as unknown as Array<{
        id: number
        conversation_id: number
        role: 'user' | 'assistant' | 'system'
        content: string
        created_at: number
        ttft_ms: number | null
        tokens_per_sec: number | null
        token_count: number | null
      }>
    )[0]!
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      ttftMs: row.ttft_ms,
      tokensPerSec: row.tokens_per_sec,
      tokenCount: row.token_count,
    }
  }

  async persistCitations(messageId: number, items: PersistCitationInput[]): Promise<void> {
    if (items.length === 0) return
    for (const it of items) {
      await this.db.execute(sql`
        INSERT INTO citations (message_id, chunk_id, document_id, score)
        VALUES (${messageId}, ${it.chunk_id}, ${it.doc_id}, ${it.score ?? null})
      `)
    }
  }

  async getWithMessages(conversationId: number): Promise<{
    conversation: {
      id: number
      workspaceId: number
      title: string | null
      activeDocumentIds: number[]
      createdAt: number
      lastActivityAt: number
      messageCount: number
    }
    messages: Array<{
      id: number
      conversationId: number
      role: 'user' | 'assistant' | 'system'
      content: string
      createdAt: number
      ttftMs: number | null
      tokensPerSec: number | null
      tokenCount: number | null
      citations: Array<{
        id: number
        messageId: number
        chunkId: number
        documentId: number
        score: number | null
        spanStart: number | null
        spanEnd: number | null
        createdAt: number
      }>
    }>
  }> {
    const cRow = await this.db.execute(sql`
      SELECT c.id, c.workspace_id, c.title, c.active_document_ids, c.created_at,
             COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
             COUNT(m.id)::INT AS message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.id = ${conversationId}
       GROUP BY c.id
    `)
    const conv = (
      cRow.rows as unknown as Array<{
        id: number
        workspace_id: number
        title: string | null
        active_document_ids: number[] | null
        created_at: number
        last_activity_at: number
        message_count: number
      }>
    )[0]
    if (!conv) throw new Error(`Conversation ${conversationId} not found`)

    const mRows = await this.db.execute(sql`
      SELECT id, conversation_id, role, content, created_at,
             ttft_ms, tokens_per_sec, token_count
        FROM messages WHERE conversation_id = ${conversationId}
       ORDER BY created_at ASC, id ASC
    `)

    type CitationRow = {
      id: number
      messageId: number
      chunkId: number
      documentId: number
      score: number | null
      spanStart: number | null
      spanEnd: number | null
      createdAt: number
    }

    const messages = (
      mRows.rows as unknown as Array<{
        id: number
        conversation_id: number
        role: 'user' | 'assistant' | 'system'
        content: string
        created_at: number
        ttft_ms: number | null
        tokens_per_sec: number | null
        token_count: number | null
      }>
    ).map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      ttftMs: m.ttft_ms,
      tokensPerSec: m.tokens_per_sec,
      tokenCount: m.token_count,
      citations: [] as CitationRow[],
    }))

    if (messages.length > 0) {
      const ids = messages.map((m) => m.id)
      const idLit = '{' + ids.join(',') + '}'
      const citRows = await this.db.execute(sql`
        SELECT id, message_id, chunk_id, document_id, score, span_start, span_end, created_at
          FROM citations
         WHERE message_id = ANY(${idLit}::int[])
         ORDER BY id ASC
      `)
      const byMessage = new Map<number, CitationRow[]>()
      for (const m of messages) byMessage.set(m.id, [])
      for (const c of citRows.rows as unknown as Array<{
        id: number
        message_id: number
        chunk_id: number
        document_id: number
        score: number | null
        span_start: number | null
        span_end: number | null
        created_at: number
      }>) {
        const list = byMessage.get(c.message_id)
        if (!list) continue
        list.push({
          id: c.id,
          messageId: c.message_id,
          chunkId: c.chunk_id,
          documentId: c.document_id,
          score: c.score,
          spanStart: c.span_start,
          spanEnd: c.span_end,
          createdAt: c.created_at,
        })
      }
      for (const m of messages) m.citations = byMessage.get(m.id) ?? []
    }

    return {
      conversation: {
        id: conv.id,
        workspaceId: conv.workspace_id,
        title: conv.title,
        activeDocumentIds: conv.active_document_ids ?? [],
        createdAt: conv.created_at,
        lastActivityAt: conv.last_activity_at,
        messageCount: conv.message_count,
      },
      messages,
    }
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

// ----- quiz ----------------------------------------------------------------

import type {
  QuizDeck,
  QuizDeckStatus,
  QuizDeckSummary,
  QuizDeckWithQuestions,
  QuizAttempt,
  QuizAttemptAnswer,
  QuizLanguage,
  QuizQuestion,
} from '../../shared/quiz'

interface QuizDeckRowSnake {
  id: number
  workspace_id: number
  name: string
  document_ids: number[] | null
  question_count: number
  status: string
  error: string | null
  language: string
  created_at: number
}

interface QuizQuestionRowSnake {
  id: number
  deck_id: number
  ordinal: number
  stem: string
  options: string[] | null
  correct_index: number
  explanation: string
  source_chunk_ids: number[] | null
  theme_title: string
}

interface QuizAttemptRowSnake {
  id: number
  deck_id: number
  started_at: number
  finished_at: number | null
  score: number | null
  answers: QuizAttemptAnswer[] | null
}

function mapDeck(row: QuizDeckRowSnake): QuizDeck {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    documentIds: row.document_ids ?? [],
    questionCount: row.question_count,
    status: row.status as QuizDeckStatus,
    error: row.error,
    language: row.language as QuizLanguage,
    createdAt: row.created_at,
  }
}

function mapQuestion(row: QuizQuestionRowSnake): QuizQuestion {
  return {
    id: row.id,
    deckId: row.deck_id,
    ordinal: row.ordinal,
    stem: row.stem,
    options: row.options ?? [],
    correctIndex: row.correct_index,
    explanation: row.explanation,
    sourceChunkIds: row.source_chunk_ids ?? [],
    themeTitle: row.theme_title,
  }
}

function mapAttempt(row: QuizAttemptRowSnake): QuizAttempt {
  return {
    id: row.id,
    deckId: row.deck_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    score: row.score,
    answers: row.answers ?? [],
  }
}

export interface NewQuizQuestionInput {
  ordinal: number
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
  themeTitle: string
}

export class QuizzesRepo {
  constructor(private readonly db: DbHandle) {}

  async createDeck(input: {
    workspaceId: number
    name: string
    documentIds: number[]
    questionCount: number
    language: QuizLanguage
  }): Promise<QuizDeck> {
    const docIdsJson = JSON.stringify(input.documentIds)
    const r = await this.db.execute(sql`
      INSERT INTO quiz_decks
        (workspace_id, name, document_ids, question_count, language)
      VALUES
        (${input.workspaceId}, ${input.name}, ${docIdsJson}::jsonb,
         ${input.questionCount}, ${input.language})
      RETURNING id, workspace_id, name, document_ids, question_count,
                status, error, language, created_at
    `)
    return mapDeck((r.rows as unknown as QuizDeckRowSnake[])[0]!)
  }

  async setDeckStatus(deckId: number, status: QuizDeckStatus, error: string | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE quiz_decks SET status = ${status}, error = ${error} WHERE id = ${deckId}
    `)
  }

  async getDeck(deckId: number): Promise<QuizDeck | null> {
    const r = await this.db.execute(sql`
      SELECT id, workspace_id, name, document_ids, question_count,
             status, error, language, created_at
        FROM quiz_decks WHERE id = ${deckId}
    `)
    const row = (r.rows as unknown as QuizDeckRowSnake[])[0]
    return row ? mapDeck(row) : null
  }

  async listDecks(workspaceId: number): Promise<QuizDeckSummary[]> {
    // Single JOIN: deck rows left-joined with their finished attempts so the
    // list screen can render last-score + attempt-count without N+1 queries.
    const r = await this.db.execute(sql`
      SELECT d.id, d.workspace_id, d.name, d.document_ids, d.question_count,
             d.status, d.error, d.language, d.created_at,
             COUNT(a.id) FILTER (WHERE a.finished_at IS NOT NULL)::INT AS attempt_count,
             (
               SELECT score FROM quiz_attempts
                WHERE deck_id = d.id AND finished_at IS NOT NULL
                ORDER BY finished_at DESC LIMIT 1
             ) AS last_score,
             (
               SELECT finished_at FROM quiz_attempts
                WHERE deck_id = d.id AND finished_at IS NOT NULL
                ORDER BY finished_at DESC LIMIT 1
             ) AS last_finished_at
        FROM quiz_decks d
        LEFT JOIN quiz_attempts a ON a.deck_id = d.id
       WHERE d.workspace_id = ${workspaceId}
       GROUP BY d.id
       ORDER BY d.created_at DESC, d.id DESC
    `)
    type Row = QuizDeckRowSnake & {
      attempt_count: number
      last_score: number | null
      last_finished_at: number | null
    }
    return (r.rows as unknown as Row[]).map((row) => ({
      ...mapDeck(row),
      attemptCount: row.attempt_count,
      lastScore: row.last_score,
      lastFinishedAt: row.last_finished_at,
    }))
  }

  async deleteDeck(deckId: number): Promise<void> {
    await this.db.execute(sql`DELETE FROM quiz_decks WHERE id = ${deckId}`)
  }

  async listQuestions(deckId: number): Promise<QuizQuestion[]> {
    const r = await this.db.execute(sql`
      SELECT id, deck_id, ordinal, stem, options, correct_index,
             explanation, source_chunk_ids, theme_title
        FROM quiz_questions WHERE deck_id = ${deckId}
       ORDER BY ordinal ASC, id ASC
    `)
    return (r.rows as unknown as QuizQuestionRowSnake[]).map(mapQuestion)
  }

  async getDeckWithQuestions(deckId: number): Promise<QuizDeckWithQuestions | null> {
    const deck = await this.getDeck(deckId)
    if (!deck) return null
    const questions = await this.listQuestions(deckId)
    return { deck, questions }
  }

  /** Insert all questions for a deck atomically. Called at the end of
   *  QuizService.generate so a partial pipeline doesn't leak half a deck. */
  async insertQuestions(deckId: number, items: NewQuizQuestionInput[]): Promise<void> {
    if (items.length === 0) return
    for (const q of items) {
      const optsJson = JSON.stringify(q.options)
      const chunksJson = JSON.stringify(q.sourceChunkIds)
      await this.db.execute(sql`
        INSERT INTO quiz_questions
          (deck_id, ordinal, stem, options, correct_index,
           explanation, source_chunk_ids, theme_title)
        VALUES
          (${deckId}, ${q.ordinal}, ${q.stem}, ${optsJson}::jsonb, ${q.correctIndex},
           ${q.explanation}, ${chunksJson}::jsonb, ${q.themeTitle})
      `)
    }
  }

  /** Wipe existing questions for a deck. Used by regenerate before re-running
   *  the pipeline. Attempts are NOT cleared (the old questionIds in answers
   *  point into rows that no longer exist — we accept that; regenerate is a
   *  deliberate user action, the history of *prior* generations is fine to
   *  break). */
  async clearQuestions(deckId: number): Promise<void> {
    await this.db.execute(sql`DELETE FROM quiz_questions WHERE deck_id = ${deckId}`)
  }

  async startAttempt(deckId: number): Promise<QuizAttempt> {
    const r = await this.db.execute(sql`
      INSERT INTO quiz_attempts (deck_id) VALUES (${deckId})
      RETURNING id, deck_id, started_at, finished_at, score, answers
    `)
    return mapAttempt((r.rows as unknown as QuizAttemptRowSnake[])[0]!)
  }

  async finishAttempt(
    attemptId: number,
    answers: QuizAttemptAnswer[],
    score: number,
  ): Promise<QuizAttempt> {
    const answersJson = JSON.stringify(answers)
    const r = await this.db.execute(sql`
      UPDATE quiz_attempts
         SET finished_at = (EXTRACT(EPOCH FROM NOW())::BIGINT),
             answers = ${answersJson}::jsonb,
             score = ${score}
       WHERE id = ${attemptId}
      RETURNING id, deck_id, started_at, finished_at, score, answers
    `)
    return mapAttempt((r.rows as unknown as QuizAttemptRowSnake[])[0]!)
  }

  async listAttempts(deckId: number): Promise<QuizAttempt[]> {
    const r = await this.db.execute(sql`
      SELECT id, deck_id, started_at, finished_at, score, answers
        FROM quiz_attempts WHERE deck_id = ${deckId}
       ORDER BY started_at DESC, id DESC
    `)
    return (r.rows as unknown as QuizAttemptRowSnake[]).map(mapAttempt)
  }

  async getAttempt(attemptId: number): Promise<QuizAttempt | null> {
    const r = await this.db.execute(sql`
      SELECT id, deck_id, started_at, finished_at, score, answers
        FROM quiz_attempts WHERE id = ${attemptId}
    `)
    const row = (r.rows as unknown as QuizAttemptRowSnake[])[0]
    return row ? mapAttempt(row) : null
  }
}
