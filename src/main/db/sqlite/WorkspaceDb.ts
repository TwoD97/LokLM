import { createClient, type Client, type InArgs } from '@libsql/client'
import { WORKSPACE_SCHEMA_SQL } from './schema.sql'
import type { SearchHit, ChunkSearchOptions, ChunkRow } from '../database'
import type {
  QuizDeck,
  QuizDeckStatus,
  QuizDeckSummary,
  QuizDeckWithQuestions,
  QuizLanguage,
  QuizQuestion,
  QuizAttempt,
  QuizAttemptAnswer,
} from '../../../shared/quiz'

export interface NewQuizQuestion {
  ordinal: number
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
  themeTitle: string
}

// One workspace's relational + full-text store: an encrypted libSQL (SQLite)
// file (ADR-0005). Replaces the in-memory PGlite layer for the per-workspace
// data, removing the WASM/RAM ceiling. Encryption is libSQL's native,
// transparent, per-page AES keyed by the workspace WDEK — no decrypt-on-open
// (unlike the LanceDB vector files). Vectors are NOT here; they live in the
// workspace's LanceDB store and join back by chunkId.

export interface NewChunk {
  ordinal: number
  text: string
  pageFrom: number | null
  pageTo: number | null
  tokenCount: number
  headingPath?: string[] | null
  language?: 'de' | 'en' | 'other' | null
}

export interface NewDocumentInput {
  title: string
  sourcePath: string
  mimeType?: string | null
  byteSize?: number | null
  status?: string
  contentHash?: string | null
  sourceMtime?: number | null
}

export interface DocumentRow {
  id: number
  title: string
  source_path: string
  status: string
  workspace_id?: number
}

/** Full document shape (camelCase), mirroring the PGlite Document the renderer +
 *  services consume, plus the aggregate `language` from listDocuments. */
export interface WsDocument {
  id: number
  workspaceId: number
  title: string
  sourcePath: string
  mimeType: string | null
  byteSize: number | null
  status: string
  chunkCount: number
  tokenCount: number
  addedAt: number
  contentHash: string | null
  sourceMtime: number | null
  missingAt: number | null
  missingDismissedAt: number | null
  summary: string | null
  pinned: boolean
  language: string | null
}

export interface ConversationRow {
  id: number
  workspaceId: number
  title: string | null
  activeDocumentIds: number[]
  createdAt: number
  lastActivityAt: number
  messageCount: number
}

export interface MessageRow {
  id: number
  conversationId: number
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  ttftMs: number | null
  tokensPerSec: number | null
  tokenCount: number | null
}

/** Summary embeddings are stored as a BLOB of float32 (ADR-0003): hundreds of
 *  docs per workspace, so cosine is computed in JS rather than needing a vector
 *  index. f32ToBlob / blobToF32 round-trip the column; cosine on normalised
 *  BGE-M3 vectors. */
function f32ToBlob(v: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(v).buffer)
}
function blobToF32(b: unknown): Float32Array | null {
  if (b == null) return null
  const buf =
    b instanceof ArrayBuffer
      ? new Uint8Array(b)
      : b instanceof Uint8Array
        ? b
        : Buffer.isBuffer(b)
          ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
          : null
  if (!buf) return null
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
}
function cosine(a: number[], b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Splits a user query into FTS5-safe OR-of-terms (recall-oriented; bm25 ranks).
 *  Each term is double-quoted so FTS5 operators in user input can't inject. */
function toMatchQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .map((t) => `"${t.replace(/"/g, '')}"`)
  return terms.join(' OR ')
}

export class WorkspaceDb {
  private constructor(
    private readonly client: Client,
    /** The relational workspace id this file belongs to — stamped onto returned
     *  rows so callers keep the cross-workspace-id shape they had under PGlite. */
    readonly workspaceId: number,
  ) {}

  /** Opens (creating + migrating) a workspace's encrypted libSQL file. `keyHex`
   *  is the workspace WDEK as hex (libSQL takes a string encryptionKey). */
  static async open(filePath: string, keyHex: string, workspaceId: number): Promise<WorkspaceDb> {
    const client = createClient({ url: `file:${filePath}`, encryptionKey: keyHex })
    await client.executeMultiple(WORKSPACE_SCHEMA_SQL)
    return new WorkspaceDb(client, workspaceId)
  }

  close(): void {
    this.client.close()
  }

  /** Raw client — for repos/services not yet ported off PGlite. */
  get raw(): Client {
    return this.client
  }

  // ---- documents ----------------------------------------------------------

  async addDocument(input: NewDocumentInput): Promise<WsDocument> {
    const r = await this.client.execute({
      sql: `INSERT INTO documents (title, source_path, mime_type, byte_size, status, content_hash, source_mtime)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        input.title,
        input.sourcePath,
        input.mimeType ?? null,
        input.byteSize ?? null,
        input.status ?? 'pending',
        input.contentHash ?? null,
        input.sourceMtime ?? null,
      ],
    })
    return this.toDoc(r.rows[0]!)
  }

  async getDocument(id: number): Promise<WsDocument | null> {
    const r = await this.client.execute({
      sql: `SELECT * FROM documents WHERE id = ?`,
      args: [id],
    })
    return r.rows[0] ? this.toDoc(r.rows[0]) : null
  }

  async findByWorkspaceAndPath(sourcePath: string): Promise<WsDocument | null> {
    const r = await this.client.execute({
      sql: `SELECT * FROM documents WHERE source_path = ? LIMIT 1`,
      args: [sourcePath],
    })
    return r.rows[0] ? this.toDoc(r.rows[0]) : null
  }

  async setDocumentStatus(id: number, status: string): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET status = ? WHERE id = ?`,
      args: [status, id],
    })
  }

  /** Deletes a document; chunks cascade (FK ON DELETE CASCADE + FTS triggers). */
  async deleteDocument(id: number): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM documents WHERE id = ?`, args: [id] })
  }

  /** Wipes a document's chunks and resets it to 'pending' for reindex (the
   *  PGlite reindex_document procedure, as app code). */
  async reindexDocument(id: number): Promise<void> {
    await this.client.batch(
      [
        { sql: `DELETE FROM chunks WHERE document_id = ?`, args: [id] },
        {
          sql: `UPDATE documents SET chunk_count = 0, token_count = 0, status = 'pending',
                summary = NULL, summary_embedding = NULL, summary_embedder_identity = NULL
                WHERE id = ?`,
          args: [id],
        },
      ],
      'write',
    )
  }

  // ---- chunks -------------------------------------------------------------

  /** Inserts chunks (FTS synced via triggers) and returns their ids in input
   *  order, so the caller can upsert vectors into LanceDB + mark them embedded. */
  async persistChunks(documentId: number, items: NewChunk[]): Promise<number[]> {
    if (items.length === 0) return []
    const stmts = items.map((c) => ({
      sql: `INSERT INTO chunks (document_id, ordinal, text, token_count, page_from, page_to, heading_path, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [
        documentId,
        c.ordinal,
        c.text.split('\u0000').join(''),
        c.tokenCount,
        c.pageFrom,
        c.pageTo,
        c.headingPath ? JSON.stringify(c.headingPath) : null,
        c.language ?? null,
      ] as InArgs,
    }))
    const results = await this.client.batch(stmts, 'write')
    const ids = results.map((r) => Number(r.rows[0]!.id))
    await this.client.execute({
      sql: `UPDATE documents SET chunk_count = (SELECT count(*) FROM chunks WHERE document_id = ?) WHERE id = ?`,
      args: [documentId, documentId],
    })
    return ids
  }

  async chunkIdsForDocument(documentId: number): Promise<number[]> {
    const r = await this.client.execute({
      sql: `SELECT id FROM chunks WHERE document_id = ?`,
      args: [documentId],
    })
    return r.rows.map((row) => Number(row.id))
  }

  // ---- embedding bookkeeping (vectors live in LanceDB; marker only here) ---

  async countChunksMissingEmbedding(): Promise<number> {
    const r = await this.client.execute(`SELECT count(*) AS n FROM chunks WHERE embedded = 0`)
    return Number(r.rows[0]!.n)
  }

  async listChunksMissingEmbedding(
    limit: number,
  ): Promise<Array<{ id: number; text: string; document_id: number }>> {
    const r = await this.client.execute({
      sql: `SELECT id, text, document_id FROM chunks WHERE embedded = 0 ORDER BY id LIMIT ?`,
      args: [limit],
    })
    return r.rows.map((row) => ({
      id: Number(row.id),
      text: String(row.text),
      document_id: Number(row.document_id),
    }))
  }

  /** Marks chunks embedded (vector is in LanceDB) + records the embedder. */
  async markChunksEmbedded(chunkIds: number[], identity: string): Promise<void> {
    if (chunkIds.length === 0) return
    const placeholders = chunkIds.map(() => '?').join(',')
    await this.client.execute({
      sql: `UPDATE chunks SET embedded = 1, embedder_identity = ? WHERE id IN (${placeholders})`,
      args: [identity, ...chunkIds.map((n) => Math.trunc(n))],
    })
  }

  /** Resets markers so the backfill re-embeds (recovery / model swap). */
  async resetEmbeddedMarkers(): Promise<number> {
    const r = await this.client.execute(
      `UPDATE chunks SET embedded = 0 WHERE embedded = 1 RETURNING id`,
    )
    return r.rows.length
  }

  async distinctEmbedderIdentities(): Promise<string[]> {
    const r = await this.client.execute(
      `SELECT DISTINCT embedder_identity FROM chunks WHERE embedded = 1`,
    )
    return r.rows.map((row) => String(row.embedder_identity))
  }

  /** Un-embeds chunks tagged with this identity (model swap); returns ids so the
   *  caller drops their vectors from LanceDB. */
  async purgeEmbeddingsByIdentity(identity: string): Promise<number[]> {
    const r = await this.client.execute({
      sql: `UPDATE chunks SET embedded = 0 WHERE embedded = 1 AND embedder_identity = ? RETURNING id`,
      args: [identity],
    })
    return r.rows.map((row) => Number(row.id))
  }

  // ---- retrieval ----------------------------------------------------------

  /** BM25 keyword search via FTS5. Mirrors the PG searchChunks SearchHit shape;
   *  score is -bm25 so higher = better (RRF-friendly, like the old ts_rank). */
  async searchChunks(
    query: string,
    topK: number,
    opts: ChunkSearchOptions = {},
  ): Promise<SearchHit[]> {
    const match = toMatchQuery(query)
    if (!match) return []
    const activeIds =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0 ? opts.activeDocumentIds : null
    const perDocK = opts.perDocK && opts.perDocK > 0 ? opts.perDocK : null
    const args: InArgs = [match]
    let docFilter = ''
    if (activeIds) {
      docFilter = ` AND c.document_id IN (${activeIds.map(() => '?').join(',')})`
      args.push(...activeIds.map((n) => Math.trunc(n)))
    }
    // bm25() may only be referenced in the query that directly MATCHes the FTS
    // table — not inside a window function. Compute it once in `base`, then
    // rank/cap in an outer level over the plain `rank` column.
    const cols = `chunk_id, document_id, document_title, ordinal, page_from, page_to,
                  heading_path, text, language, added_at, -rank AS score`
    const base = `
      SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS document_title,
             c.ordinal AS ordinal, c.page_from AS page_from, c.page_to AS page_to,
             c.heading_path AS heading_path, c.text AS text, c.language AS language,
             d.added_at AS added_at, bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c    ON c.id = chunks_fts.rowid
        JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ? AND d.status = 'ready'${docFilter}`
    let sql: string
    if (perDocK) {
      sql = `WITH base AS (${base}),
                  ranked AS (SELECT base.*,
                               row_number() OVER (PARTITION BY document_id ORDER BY rank ASC) AS doc_rank
                             FROM base)
             SELECT ${cols} FROM ranked WHERE doc_rank <= ? ORDER BY rank ASC LIMIT ?`
      args.push(perDocK, topK)
    } else {
      sql = `WITH base AS (${base}) SELECT ${cols} FROM base ORDER BY rank ASC LIMIT ?`
      args.push(topK)
    }
    const r = await this.client.execute({ sql, args })
    return r.rows.map((row) => this.toHit(row))
  }

  /** Hydrates LanceDB vector hits (chunkId+documentId+score) into full SearchHit
   *  rows, preserving the incoming score order. Drops ids whose document is not
   *  'ready' (mirrors the PG path). */
  async hydrateChunkHits(
    scored: Array<{ chunkId: number; documentId: number; score: number }>,
  ): Promise<SearchHit[]> {
    if (scored.length === 0) return []
    const ids = scored.map((s) => Math.trunc(s.chunkId))
    const r = await this.client.execute({
      sql: `SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS document_title,
                   c.ordinal AS ordinal, c.page_from AS page_from, c.page_to AS page_to,
                   c.heading_path AS heading_path, c.text AS text, c.language AS language,
                   d.added_at AS added_at
              FROM chunks c JOIN documents d ON d.id = c.document_id
             WHERE c.id IN (${ids.map(() => '?').join(',')}) AND d.status = 'ready'`,
      args: ids,
    })
    const byId = new Map<number, SearchHit>(
      r.rows.map((row) => [Number(row.chunk_id), this.toHit(row)]),
    )
    const out: SearchHit[] = []
    for (const s of scored) {
      const hit = byId.get(Math.trunc(s.chunkId))
      if (hit) out.push({ ...hit, score: s.score })
    }
    return out
  }

  // ---- document metadata / lifecycle -------------------------------------

  async setSourceMetadata(
    documentId: number,
    fields: {
      sourcePath?: string
      title?: string
      mimeType?: string | null
      byteSize?: number | null
      contentHash?: string | null
      sourceMtime?: number | null
    },
  ): Promise<void> {
    const map: Record<string, string> = {
      sourcePath: 'source_path',
      title: 'title',
      mimeType: 'mime_type',
      byteSize: 'byte_size',
      contentHash: 'content_hash',
      sourceMtime: 'source_mtime',
    }
    const sets: string[] = []
    const args: InArgs = []
    for (const [k, col] of Object.entries(map)) {
      if (k in fields) {
        sets.push(`${col} = ?`)
        args.push((fields as Record<string, unknown>)[k] as never)
      }
    }
    if (sets.length === 0) return
    args.push(documentId)
    await this.client.execute({ sql: `UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, args })
  }

  async findByPath(sourcePath: string): Promise<DocumentRow | null> {
    const r = await this.client.execute({
      sql: `SELECT id, title, source_path, status FROM documents WHERE source_path = ? LIMIT 1`,
      args: [sourcePath],
    })
    return (r.rows[0] as unknown as DocumentRow) ?? null
  }

  async markMissing(documentId: number): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET missing_at = COALESCE(missing_at, unixepoch()) WHERE id = ?`,
      args: [documentId],
    })
  }

  async clearMissing(documentId: number): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET missing_at = NULL, missing_dismissed_at = NULL WHERE id = ?`,
      args: [documentId],
    })
  }

  async dismissMissing(documentId: number): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET missing_dismissed_at = unixepoch() WHERE id = ?`,
      args: [documentId],
    })
  }

  async listMissingUnacknowledged(): Promise<WsDocument[]> {
    const r = await this.client.execute(
      `SELECT * FROM documents
        WHERE missing_at IS NOT NULL
          AND (missing_dismissed_at IS NULL OR missing_dismissed_at < missing_at)
        ORDER BY missing_at DESC, id DESC`,
    )
    return r.rows.map((row) => this.toDoc(row))
  }

  async setPinned(documentId: number, pinned: boolean): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET pinned = ? WHERE id = ?`,
      args: [pinned ? 1 : 0, documentId],
    })
  }

  async listPinned(): Promise<WsDocument[]> {
    const r = await this.client.execute(`SELECT * FROM documents WHERE pinned = 1 ORDER BY title`)
    return r.rows.map((row) => this.toDoc(row))
  }

  async resetStuckIndexing(): Promise<number> {
    const r = await this.client.execute(
      `UPDATE documents SET status = 'failed' WHERE status IN ('indexing', 'pending') RETURNING id`,
    )
    return r.rows.length
  }

  /** Documents with a per-document aggregate language (mig 0007 equivalent):
   *  dominant ≥70% → 'de'|'en', mixed otherwise, null when nothing detected. */
  async listDocuments(): Promise<WsDocument[]> {
    const r = await this.client.execute(`
      SELECT d.*, (
        SELECT CASE
          WHEN SUM(c.language IS NOT NULL) = 0 THEN NULL
          WHEN CAST(SUM(c.language = 'de') AS REAL) / SUM(c.language IS NOT NULL) >= 0.7 THEN 'de'
          WHEN CAST(SUM(c.language = 'en') AS REAL) / SUM(c.language IS NOT NULL) >= 0.7 THEN 'en'
          ELSE 'mixed'
        END FROM chunks c WHERE c.document_id = d.id
      ) AS language
      FROM documents d ORDER BY d.added_at DESC`)
    return r.rows.map((row) => this.toDoc(row))
  }

  async listDocumentTitles(): Promise<Array<{ id: number; title: string }>> {
    const r = await this.client.execute(`SELECT id, title FROM documents WHERE status = 'ready'`)
    return r.rows.map((row) => ({ id: Number(row.id), title: String(row.title) }))
  }

  async getCitedChunkSource(chunkId: number): Promise<{
    document: WsDocument
    pageFrom: number | null
    pageTo: number | null
    headingPath: string[] | null
  } | null> {
    const r = await this.client.execute({
      sql: `SELECT d.*, c.page_from AS c_page_from, c.page_to AS c_page_to, c.heading_path AS c_heading_path
              FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ? LIMIT 1`,
      args: [chunkId],
    })
    const row = r.rows[0]
    if (!row) return null
    return {
      document: this.toDoc(row),
      pageFrom: row.c_page_from == null ? null : Number(row.c_page_from),
      pageTo: row.c_page_to == null ? null : Number(row.c_page_to),
      headingPath: row.c_heading_path ? (JSON.parse(String(row.c_heading_path)) as string[]) : null,
    }
  }

  // ---- summaries + summary embeddings (ADR-0003) --------------------------

  async setSummary(documentId: number, summary: string | null): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET summary = ?, summary_embedding = NULL, summary_embedder_identity = NULL WHERE id = ?`,
      args: [summary, documentId],
    })
  }

  async setSummaryEmbedding(documentId: number, vector: number[], identity: string): Promise<void> {
    await this.client.execute({
      sql: `UPDATE documents SET summary_embedding = ?, summary_embedder_identity = ? WHERE id = ?`,
      args: [f32ToBlob(vector), identity, documentId],
    })
  }

  async listDocsMissingSummaryEmbedding(
    limit: number,
  ): Promise<Array<{ id: number; summary: string }>> {
    const r = await this.client.execute({
      sql: `SELECT id, summary FROM documents
             WHERE status = 'ready' AND summary IS NOT NULL AND summary_embedding IS NULL
             ORDER BY id LIMIT ?`,
      args: [limit],
    })
    return r.rows.map((row) => ({ id: Number(row.id), summary: String(row.summary) }))
  }

  async countDocsMissingSummaryEmbedding(): Promise<number> {
    const r = await this.client.execute(
      `SELECT count(*) AS n FROM documents WHERE status = 'ready' AND summary IS NOT NULL AND summary_embedding IS NULL`,
    )
    return Number(r.rows[0]!.n)
  }

  async distinctSummaryEmbedderIdentities(): Promise<string[]> {
    const r = await this.client.execute(
      `SELECT DISTINCT summary_embedder_identity AS i FROM documents
        WHERE summary_embedding IS NOT NULL AND summary_embedder_identity IS NOT NULL`,
    )
    return r.rows.map((row) => String(row.i))
  }

  async purgeSummaryEmbeddingsByIdentity(identity: string): Promise<number> {
    const r = await this.client.execute({
      sql: `UPDATE documents SET summary_embedding = NULL, summary_embedder_identity = NULL
             WHERE summary_embedder_identity = ? RETURNING id`,
      args: [identity],
    })
    return r.rows.length
  }

  /** Top documents by summary-embedding cosine (ADR-0003 hierarchical prefilter).
   *  Cosine in JS over the BLOB embeddings (few hundred docs). */
  async topDocumentsBySummarySimilarity(
    queryVec: number[],
    k: number,
    opts: { activeDocumentIds?: number[] | null; minSimilarity?: number } = {},
  ): Promise<Array<{ id: number; score: number }>> {
    if (queryVec.length === 0 || k <= 0) return []
    const minSim = opts.minSimilarity ?? 0.2
    const active =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0
        ? new Set(opts.activeDocumentIds)
        : null
    const r = await this.client.execute(
      `SELECT id, summary_embedding FROM documents
        WHERE status = 'ready' AND summary_embedding IS NOT NULL`,
    )
    const scored: Array<{ id: number; score: number }> = []
    for (const row of r.rows) {
      const id = Number(row.id)
      if (active && !active.has(id)) continue
      const vec = blobToF32(row.summary_embedding)
      if (!vec) continue
      const score = cosine(queryVec, vec)
      if (score >= minSim) scored.push({ id, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  /** Corpus route (ADR-0003): documents about a theme. Union of FTS5 chunk
   *  mentions, title/summary LIKE, and (optional) summary-embedding cosine. */
  async searchDocumentsByTheme(
    themeTokens: string[],
    opts: {
      activeDocumentIds?: number[] | null
      themeEmbedding?: number[] | null
      similarityThreshold?: number
    } = {},
  ): Promise<Array<{ id: number; title: string; chunkHits: number; firstChunkId: number | null }>> {
    const active =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0
        ? new Set(opts.activeDocumentIds)
        : null
    // chunk-mention counts per document via FTS5 (empty theme → no FTS signal)
    const hits = new Map<number, number>()
    const match = toMatchQuery(themeTokens.join(' '))
    if (match) {
      const r = await this.client.execute({
        sql: `SELECT c.document_id AS did, count(*) AS n
                FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
                JOIN documents d ON d.id = c.document_id
               WHERE chunks_fts MATCH ? AND d.status = 'ready'
               GROUP BY c.document_id`,
        args: [match],
      })
      for (const row of r.rows) hits.set(Number(row.did), Number(row.n))
    }
    const likes = themeTokens.map((t) => `%${t.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`)
    const threshold = opts.similarityThreshold ?? 0.2
    const useEmb = !!(opts.themeEmbedding && opts.themeEmbedding.length > 0)
    const r = await this.client.execute(
      `SELECT id, title, lower(title) AS lt, lower(COALESCE(summary, '')) AS ls, summary_embedding,
              (SELECT id FROM chunks WHERE document_id = documents.id ORDER BY ordinal LIMIT 1) AS first_chunk_id
         FROM documents WHERE status = 'ready'`,
    )
    const out: Array<{
      id: number
      title: string
      chunkHits: number
      firstChunkId: number | null
    }> = []
    for (const row of r.rows) {
      const id = Number(row.id)
      if (active && !active.has(id)) continue
      const h = hits.get(id) ?? 0
      const lt = String(row.lt)
      const ls = String(row.ls)
      const likeMatch =
        likes.length === 0 ||
        h > 0 ||
        likes.some((p) => {
          const needle = p.slice(1, -1).replace(/\\([\\%_])/g, '$1')
          return lt.includes(needle) || ls.includes(needle)
        })
      let member = likes.length === 0 ? true : likeMatch
      if (!member && useEmb) {
        const vec = blobToF32(row.summary_embedding)
        if (vec && cosine(opts.themeEmbedding!, vec) >= threshold) member = true
      }
      if (member) {
        out.push({
          id,
          title: String(row.title),
          chunkHits: h,
          firstChunkId: row.first_chunk_id == null ? null : Number(row.first_chunk_id),
        })
      }
    }
    out.sort((a, b) => b.chunkHits - a.chunkHits || a.title.localeCompare(b.title) || a.id - b.id)
    return out
  }

  // ---- chunk context / neighbours ----------------------------------------

  async listChunksForDocument(documentId: number): Promise<ChunkRow[]> {
    const r = await this.client.execute({
      sql: `SELECT id, document_id, ordinal, text, token_count, page_from, page_to, heading_path, language
              FROM chunks WHERE document_id = ? ORDER BY ordinal`,
      args: [documentId],
    })
    return r.rows.map((row) => this.toChunkRow(row))
  }

  async getChunkCounts(documentIds: number[]): Promise<Map<number, number>> {
    if (documentIds.length === 0) return new Map()
    const r = await this.client.execute({
      sql: `SELECT document_id AS did, count(*) AS n FROM chunks
             WHERE document_id IN (${documentIds.map(() => '?').join(',')}) GROUP BY document_id`,
      args: documentIds.map((n) => Math.trunc(n)),
    })
    const map = new Map<number, number>()
    for (const row of r.rows) map.set(Number(row.did), Number(row.n))
    return map
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
    const r = await this.client.execute({
      sql: `WITH t AS (SELECT document_id, ordinal FROM chunks WHERE id = ?)
            SELECT c.id, c.document_id, c.ordinal, c.text, c.token_count, c.page_from, c.page_to,
                   (c.id = ?) AS is_target
              FROM chunks c, t
             WHERE c.document_id = t.document_id
               AND c.ordinal BETWEEN t.ordinal - ? AND t.ordinal + ?
             ORDER BY c.ordinal`,
      args: [chunkId, chunkId, before, after],
    })
    return r.rows.map((row) => ({
      id: Number(row.id),
      documentId: Number(row.document_id),
      ordinal: Number(row.ordinal),
      text: String(row.text),
      tokenCount: row.token_count == null ? null : Number(row.token_count),
      pageFrom: row.page_from == null ? null : Number(row.page_from),
      pageTo: row.page_to == null ? null : Number(row.page_to),
      isTarget: Number(row.is_target) === 1,
    }))
  }

  async getNeighbourChunks(
    seeds: Array<{ documentId: number; ordinal: number }>,
    radius: number,
  ): Promise<ChunkRow[]> {
    if (seeds.length === 0 || radius <= 0) return []
    const clauses = seeds
      .map(() => `(c.document_id = ? AND c.ordinal BETWEEN ? AND ?)`)
      .join(' OR ')
    const args: InArgs = []
    for (const s of seeds) args.push(s.documentId, s.ordinal - radius, s.ordinal + radius)
    const r = await this.client.execute({
      sql: `SELECT DISTINCT c.id, c.document_id, c.ordinal, c.text, c.token_count, c.page_from,
                   c.page_to, c.heading_path, c.language
              FROM chunks c WHERE ${clauses} ORDER BY c.document_id, c.ordinal`,
      args,
    })
    return r.rows.map((row) => this.toChunkRow(row))
  }

  // ---- conversations / messages / citations ------------------------------

  async createConversation(
    title?: string | null,
    activeDocumentIds?: number[],
  ): Promise<ConversationRow> {
    const r = await this.client.execute({
      sql: `INSERT INTO conversations (title, active_document_ids) VALUES (?, ?)
            RETURNING id, title, active_document_ids, created_at`,
      args: [title ?? null, JSON.stringify(activeDocumentIds ?? [])],
    })
    return this.toConversation(r.rows[0]!, Number(r.rows[0]!.created_at), 0)
  }

  async setConversationTitle(id: number, title: string | null): Promise<void> {
    await this.client.execute({
      sql: `UPDATE conversations SET title = ? WHERE id = ?`,
      args: [title, id],
    })
  }

  async setActiveDocumentIds(conversationId: number, ids: number[]): Promise<void> {
    await this.client.execute({
      sql: `UPDATE conversations SET active_document_ids = ? WHERE id = ?`,
      args: [JSON.stringify(ids), conversationId],
    })
  }

  async listConversations(): Promise<ConversationRow[]> {
    const r = await this.client.execute(
      `SELECT c.id, c.title, c.active_document_ids, c.created_at,
              COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
              COUNT(m.id) AS message_count
         FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id ORDER BY last_activity_at DESC, c.id DESC`,
    )
    return r.rows.map((row) =>
      this.toConversation(row, Number(row.last_activity_at), Number(row.message_count)),
    )
  }

  async deleteConversation(id: number): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM conversations WHERE id = ?`, args: [id] })
  }

  async deleteMessage(messageId: number): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM messages WHERE id = ?`, args: [messageId] })
  }

  async appendMessage(
    conversationId: number,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metrics?: { ttftMs: number | null; tokensPerSec: number | null; tokenCount: number | null },
  ): Promise<MessageRow> {
    const r = await this.client.execute({
      sql: `INSERT INTO messages (conversation_id, role, content, ttft_ms, tokens_per_sec, token_count)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id, conversation_id, role, content, created_at, ttft_ms, tokens_per_sec, token_count`,
      args: [
        conversationId,
        role,
        content,
        metrics?.ttftMs ?? null,
        metrics?.tokensPerSec ?? null,
        metrics?.tokenCount ?? null,
      ],
    })
    return this.toMessage(r.rows[0]!)
  }

  async persistCitations(
    messageId: number,
    items: Array<{ chunk_id: number; score?: number | null }>,
  ): Promise<void> {
    if (items.length === 0) return
    await this.client.batch(
      items.map((it) => ({
        sql: `INSERT INTO citations (message_id, chunk_id, score) VALUES (?, ?, ?)`,
        args: [messageId, it.chunk_id, it.score ?? null] as InArgs,
      })),
      'write',
    )
  }

  async getConversationWithMessages(
    conversationId: number,
  ): Promise<{ conversation: ConversationRow; messages: MessageRow[] } | null> {
    const c = await this.client.execute({
      sql: `SELECT c.id, c.title, c.active_document_ids, c.created_at,
                   COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
                   COUNT(m.id) AS message_count
              FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.id = ? GROUP BY c.id`,
      args: [conversationId],
    })
    if (!c.rows[0] || c.rows[0].id == null) return null
    const conversation = this.toConversation(
      c.rows[0],
      Number(c.rows[0].last_activity_at),
      Number(c.rows[0].message_count),
    )
    const m = await this.client.execute({
      sql: `SELECT id, conversation_id, role, content, created_at, ttft_ms, tokens_per_sec, token_count
              FROM messages WHERE conversation_id = ? ORDER BY id`,
      args: [conversationId],
    })
    return { conversation, messages: m.rows.map((row) => this.toMessage(row)) }
  }

  // ---- row mappers --------------------------------------------------------

  // ---- sync folders -------------------------------------------------------

  async getSyncFolders(): Promise<string[]> {
    const r = await this.client.execute(`SELECT path FROM sync_folders ORDER BY path`)
    return r.rows.map((row) => String(row.path))
  }

  async setSyncFolders(folders: string[]): Promise<void> {
    const stmts = [{ sql: `DELETE FROM sync_folders`, args: [] as InArgs }]
    for (const p of folders) {
      stmts.push({ sql: `INSERT OR IGNORE INTO sync_folders (path) VALUES (?)`, args: [p] })
    }
    await this.client.batch(stmts, 'write')
  }

  // ---- quiz ---------------------------------------------------------------

  async createDeck(input: {
    name: string
    documentIds: number[]
    questionCount: number
    language: QuizLanguage
  }): Promise<QuizDeck> {
    const r = await this.client.execute({
      sql: `INSERT INTO quiz_decks (name, document_ids, question_count, language)
            VALUES (?, ?, ?, ?)
            RETURNING id, name, document_ids, question_count, status, error, language, created_at`,
      args: [input.name, JSON.stringify(input.documentIds), input.questionCount, input.language],
    })
    return this.toDeck(r.rows[0]!)
  }

  async setDeckStatus(deckId: number, status: QuizDeckStatus, error: string | null): Promise<void> {
    await this.client.execute({
      sql: `UPDATE quiz_decks SET status = ?, error = ? WHERE id = ?`,
      args: [status, error, deckId],
    })
  }

  async updateDeckQuestionCount(deckId: number, questionCount: number): Promise<void> {
    await this.client.execute({
      sql: `UPDATE quiz_decks SET question_count = ? WHERE id = ?`,
      args: [questionCount, deckId],
    })
  }

  async resetStuckDecks(): Promise<number> {
    const r = await this.client.execute(
      `UPDATE quiz_decks SET status = 'failed',
              error = 'Generation was interrupted (app closed or locked). Retry to regenerate.'
        WHERE status = 'generating' RETURNING id`,
    )
    return r.rows.length
  }

  async getDeck(deckId: number): Promise<QuizDeck | null> {
    const r = await this.client.execute({
      sql: `SELECT id, name, document_ids, question_count, status, error, language, created_at
              FROM quiz_decks WHERE id = ?`,
      args: [deckId],
    })
    return r.rows[0] ? this.toDeck(r.rows[0]) : null
  }

  async listDecks(): Promise<QuizDeckSummary[]> {
    const r = await this.client.execute(
      `SELECT d.id, d.name, d.document_ids, d.question_count, d.status, d.error, d.language, d.created_at,
              COUNT(a.id) FILTER (WHERE a.finished_at IS NOT NULL) AS attempt_count,
              (SELECT score FROM quiz_attempts WHERE deck_id = d.id AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, id DESC LIMIT 1) AS last_score,
              (SELECT finished_at FROM quiz_attempts WHERE deck_id = d.id AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, id DESC LIMIT 1) AS last_finished_at
         FROM quiz_decks d LEFT JOIN quiz_attempts a ON a.deck_id = d.id
        GROUP BY d.id ORDER BY d.created_at DESC, d.id DESC`,
    )
    return r.rows.map((row) => ({
      ...this.toDeck(row),
      attemptCount: Number(row.attempt_count ?? 0),
      lastScore: row.last_score == null ? null : Number(row.last_score),
      lastFinishedAt: row.last_finished_at == null ? null : Number(row.last_finished_at),
    }))
  }

  async deleteDeck(deckId: number): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM quiz_decks WHERE id = ?`, args: [deckId] })
  }

  async listQuestions(deckId: number): Promise<QuizQuestion[]> {
    const r = await this.client.execute({
      sql: `SELECT id, deck_id, ordinal, stem, options, correct_index, explanation, source_chunk_ids, theme_title
              FROM quiz_questions WHERE deck_id = ? ORDER BY ordinal ASC, id ASC`,
      args: [deckId],
    })
    return r.rows.map((row) => this.toQuestion(row))
  }

  async getDeckWithQuestions(deckId: number): Promise<QuizDeckWithQuestions | null> {
    const deck = await this.getDeck(deckId)
    if (!deck) return null
    return { deck, questions: await this.listQuestions(deckId) }
  }

  async insertQuestions(deckId: number, items: NewQuizQuestion[]): Promise<void> {
    if (items.length === 0) return
    await this.client.batch(
      items.map((q) => ({
        sql: `INSERT INTO quiz_questions
                (deck_id, ordinal, stem, options, correct_index, explanation, source_chunk_ids, theme_title)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          deckId,
          q.ordinal,
          q.stem,
          JSON.stringify(q.options),
          q.correctIndex,
          q.explanation,
          JSON.stringify(q.sourceChunkIds),
          q.themeTitle,
        ] as InArgs,
      })),
      'write',
    )
  }

  async clearQuestions(deckId: number): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM quiz_questions WHERE deck_id = ?`,
      args: [deckId],
    })
  }

  async deleteAttempts(deckId: number): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM quiz_attempts WHERE deck_id = ?`,
      args: [deckId],
    })
  }

  async startAttempt(deckId: number): Promise<QuizAttempt> {
    const r = await this.client.execute({
      sql: `INSERT INTO quiz_attempts (deck_id) VALUES (?)
            RETURNING id, deck_id, started_at, finished_at, score, answers`,
      args: [deckId],
    })
    return this.toAttempt(r.rows[0]!)
  }

  async finishAttempt(
    attemptId: number,
    answers: QuizAttemptAnswer[],
    score: number,
  ): Promise<QuizAttempt> {
    const r = await this.client.execute({
      sql: `UPDATE quiz_attempts SET finished_at = unixepoch(), answers = ?, score = ?
             WHERE id = ?
            RETURNING id, deck_id, started_at, finished_at, score, answers`,
      args: [JSON.stringify(answers), score, attemptId],
    })
    return this.toAttempt(r.rows[0]!)
  }

  async listAttempts(deckId: number): Promise<QuizAttempt[]> {
    const r = await this.client.execute({
      sql: `SELECT id, deck_id, started_at, finished_at, score, answers
              FROM quiz_attempts WHERE deck_id = ?
             ORDER BY finished_at DESC NULLS LAST, started_at DESC, id DESC`,
      args: [deckId],
    })
    return r.rows.map((row) => this.toAttempt(row))
  }

  async getAttempt(attemptId: number): Promise<QuizAttempt | null> {
    const r = await this.client.execute({
      sql: `SELECT id, deck_id, started_at, finished_at, score, answers FROM quiz_attempts WHERE id = ?`,
      args: [attemptId],
    })
    return r.rows[0] ? this.toAttempt(r.rows[0]) : null
  }

  // ---- row mappers --------------------------------------------------------

  private toDeck(row: Record<string, unknown>): QuizDeck {
    return {
      id: Number(row.id),
      workspaceId: this.workspaceId,
      name: String(row.name),
      documentIds: row.document_ids ? (JSON.parse(String(row.document_ids)) as number[]) : [],
      questionCount: Number(row.question_count),
      status: String(row.status) as QuizDeckStatus,
      error: (row.error ?? null) as string | null,
      language: String(row.language) as QuizLanguage,
      createdAt: Number(row.created_at),
    }
  }

  private toQuestion(row: Record<string, unknown>): QuizQuestion {
    return {
      id: Number(row.id),
      deckId: Number(row.deck_id),
      ordinal: Number(row.ordinal),
      stem: String(row.stem),
      options: row.options ? (JSON.parse(String(row.options)) as string[]) : [],
      correctIndex: Number(row.correct_index),
      explanation: String(row.explanation),
      sourceChunkIds: row.source_chunk_ids
        ? (JSON.parse(String(row.source_chunk_ids)) as number[])
        : [],
      themeTitle: String(row.theme_title),
    }
  }

  private toAttempt(row: Record<string, unknown>): QuizAttempt {
    return {
      id: Number(row.id),
      deckId: Number(row.deck_id),
      startedAt: Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      score: row.score == null ? null : Number(row.score),
      answers: row.answers ? (JSON.parse(String(row.answers)) as QuizAttemptAnswer[]) : [],
    }
  }

  private toDoc(row: Record<string, unknown>): WsDocument {
    return {
      id: Number(row.id),
      workspaceId: this.workspaceId,
      title: String(row.title),
      sourcePath: String(row.source_path),
      mimeType: (row.mime_type ?? null) as string | null,
      byteSize: row.byte_size == null ? null : Number(row.byte_size),
      status: String(row.status),
      chunkCount: Number(row.chunk_count ?? 0),
      tokenCount: Number(row.token_count ?? 0),
      addedAt: Number(row.added_at),
      contentHash: (row.content_hash ?? null) as string | null,
      sourceMtime: row.source_mtime == null ? null : Number(row.source_mtime),
      missingAt: row.missing_at == null ? null : Number(row.missing_at),
      missingDismissedAt:
        row.missing_dismissed_at == null ? null : Number(row.missing_dismissed_at),
      summary: (row.summary ?? null) as string | null,
      pinned: Number(row.pinned ?? 0) === 1,
      language: (row.language ?? null) as string | null,
    }
  }

  private toChunkRow(row: Record<string, unknown>): ChunkRow {
    return {
      id: Number(row.id),
      document_id: Number(row.document_id),
      ordinal: Number(row.ordinal),
      text: String(row.text),
      token_count: row.token_count == null ? null : Number(row.token_count),
      page_from: row.page_from == null ? null : Number(row.page_from),
      page_to: row.page_to == null ? null : Number(row.page_to),
      heading_path: row.heading_path ? (JSON.parse(String(row.heading_path)) as string[]) : null,
      language: (row.language ?? null) as 'de' | 'en' | 'other' | null,
    }
  }

  private toConversation(
    row: Record<string, unknown>,
    lastActivityAt: number,
    messageCount: number,
  ): ConversationRow {
    return {
      id: Number(row.id),
      workspaceId: this.workspaceId,
      title: (row.title ?? null) as string | null,
      activeDocumentIds: row.active_document_ids
        ? (JSON.parse(String(row.active_document_ids)) as number[])
        : [],
      createdAt: Number(row.created_at),
      lastActivityAt,
      messageCount,
    }
  }

  private toMessage(row: Record<string, unknown>): MessageRow {
    return {
      id: Number(row.id),
      conversationId: Number(row.conversation_id),
      role: String(row.role) as 'user' | 'assistant' | 'system',
      content: String(row.content),
      createdAt: Number(row.created_at),
      ttftMs: row.ttft_ms == null ? null : Number(row.ttft_ms),
      tokensPerSec: row.tokens_per_sec == null ? null : Number(row.tokens_per_sec),
      tokenCount: row.token_count == null ? null : Number(row.token_count),
    }
  }

  private toHit(row: Record<string, unknown>): SearchHit {
    return {
      chunk_id: Number(row.chunk_id),
      document_id: Number(row.document_id),
      document_title: String(row.document_title),
      ordinal: Number(row.ordinal),
      page_from: row.page_from == null ? null : Number(row.page_from),
      page_to: row.page_to == null ? null : Number(row.page_to),
      heading_path: row.heading_path ? (JSON.parse(String(row.heading_path)) as string[]) : null,
      text: String(row.text),
      language: (row.language ?? null) as 'de' | 'en' | 'other' | null,
      score: row.score == null ? 0 : Number(row.score),
      added_at: row.added_at == null ? null : Number(row.added_at),
    }
  }
}
