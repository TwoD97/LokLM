import Database from 'better-sqlite3-multiple-ciphers'
import { WORKSPACE_SCHEMA_SQL } from './schema.sql'
import type { SearchHit, ChunkSearchOptions, ChunkRow, LibrarySearchRow } from '../types'
import type { LibrarySearchOptions } from '../../../shared/documents'
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

// One workspace's relational + full-text store: an encrypted SQLite file via
// better-sqlite3-multiple-ciphers (SQLCipher/AES), ADR-0005. Replaces the
// in-memory PGlite layer per workspace, removing the WASM/RAM ceiling. The
// engine is synchronous (fastest SQLite for Node, Signal-grade); methods keep
// async signatures so callers/services are unchanged. Encryption is transparent
// per-page AES keyed by the workspace WDEK (raw 256-bit key). Vectors are NOT
// here — they live in the workspace's LanceDB store and join back by chunkId.

type SqlArg = string | number | bigint | Buffer | null
type Row = Record<string, unknown>

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

export interface NewQuizQuestion {
  ordinal: number
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
  themeTitle: string
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

export interface CitationRow {
  id: number
  messageId: number
  chunkId: number
  documentId: number
  score: number | null
  spanStart: number | null
  spanEnd: number | null
  createdAt: number
}

export interface MessageWithCitations extends MessageRow {
  citations: CitationRow[]
}

/** Summary embeddings are stored as a BLOB of float32 (ADR-0003): hundreds of
 *  docs per workspace, so cosine is computed in JS. */
function f32ToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer)
}
function blobToF32(b: unknown): Float32Array | null {
  if (!b || !Buffer.isBuffer(b)) return null
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
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

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|h|cpp|hpp|cs|rb|php|swift|sh|sql|json|yaml|yml|toml|html|css|scss|xml)$/

/** Maps a source path to a library doc-type bucket (mirrors the PG CASE). */
function docTypeOf(sourcePath: string): string {
  const p = sourcePath.toLowerCase()
  if (p.endsWith('.pdf')) return 'pdf'
  if (p.endsWith('.docx')) return 'docx'
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'md'
  if (CODE_EXT.test(p)) return 'code'
  return 'txt'
}

/** Splits a user query into FTS5-safe OR-of-terms (recall-oriented; bm25 ranks).
 *  Each term is double-quoted so FTS5 operators in user input can't inject. */
function toMatchQuery(query: string): string {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(' OR ')
}

export class WorkspaceDb {
  private constructor(
    private readonly db: Database.Database,
    /** The relational workspace id this file belongs to — stamped onto returned
     *  rows so callers keep the cross-workspace-id shape they had under PGlite. */
    readonly workspaceId: number,
  ) {}

  /** Opens (creating + migrating) a workspace's encrypted SQLite file. `keyHex`
   *  is the workspace WDEK as 64 hex chars; used as a raw 256-bit SQLCipher key
   *  (no KDF — the WDEK is already a strong random key). */
  static async open(filePath: string, keyHex: string, workspaceId: number): Promise<WorkspaceDb> {
    const db = new Database(filePath)
    db.pragma(`cipher='sqlcipher'`)
    db.pragma(`key="x'${keyHex}'"`)
    db.pragma('foreign_keys = ON')
    db.exec(WORKSPACE_SCHEMA_SQL)
    return new WorkspaceDb(db, workspaceId)
  }

  close(): void {
    this.db.close()
  }

  // ---- low-level helpers (sync better-sqlite3, exact-arity binding) --------

  private rows(sql: string, args: SqlArg[] = []): Row[] {
    return this.db.prepare(sql).all(...args) as Row[]
  }
  private one(sql: string, args: SqlArg[] = []): Row | undefined {
    return this.db.prepare(sql).get(...args) as Row | undefined
  }
  private run(sql: string, args: SqlArg[] = []): void {
    this.db.prepare(sql).run(...args)
  }

  // ---- documents ----------------------------------------------------------

  async addDocument(input: NewDocumentInput): Promise<WsDocument> {
    const row = this.one(
      `INSERT INTO documents (title, source_path, mime_type, byte_size, status, content_hash, source_mtime)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        input.title,
        input.sourcePath,
        input.mimeType ?? null,
        input.byteSize ?? null,
        input.status ?? 'pending',
        input.contentHash ?? null,
        input.sourceMtime ?? null,
      ],
    )
    return this.toDoc(row!)
  }

  async getDocument(id: number): Promise<WsDocument | null> {
    const row = this.one(`SELECT * FROM documents WHERE id = ?`, [id])
    return row ? this.toDoc(row) : null
  }

  async findByWorkspaceAndPath(sourcePath: string): Promise<WsDocument | null> {
    const row = this.one(`SELECT * FROM documents WHERE source_path = ? LIMIT 1`, [sourcePath])
    return row ? this.toDoc(row) : null
  }

  async setDocumentStatus(id: number, status: string): Promise<void> {
    this.run(`UPDATE documents SET status = ? WHERE id = ?`, [status, id])
  }

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
    const args: SqlArg[] = []
    for (const [k, col] of Object.entries(map)) {
      if (k in fields) {
        sets.push(`${col} = ?`)
        args.push((fields as Record<string, SqlArg>)[k] ?? null)
      }
    }
    if (sets.length === 0) return
    args.push(documentId)
    this.run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, args)
  }

  async deleteDocument(id: number): Promise<void> {
    this.run(`DELETE FROM documents WHERE id = ?`, [id])
  }

  /** Wipes a document's chunks and resets it to 'pending' (PGlite's
   *  reindex_document procedure, as a transaction). */
  async reindexDocument(id: number): Promise<void> {
    this.db.transaction(() => {
      this.run(`DELETE FROM chunks WHERE document_id = ?`, [id])
      this.run(
        `UPDATE documents SET chunk_count = 0, token_count = 0, status = 'pending',
         summary = NULL, summary_embedding = NULL, summary_embedder_identity = NULL WHERE id = ?`,
        [id],
      )
    })()
  }

  async markMissing(documentId: number): Promise<void> {
    this.run(`UPDATE documents SET missing_at = COALESCE(missing_at, unixepoch()) WHERE id = ?`, [
      documentId,
    ])
  }

  async clearMissing(documentId: number): Promise<void> {
    this.run(`UPDATE documents SET missing_at = NULL, missing_dismissed_at = NULL WHERE id = ?`, [
      documentId,
    ])
  }

  async dismissMissing(documentId: number): Promise<void> {
    this.run(`UPDATE documents SET missing_dismissed_at = unixepoch() WHERE id = ?`, [documentId])
  }

  async listMissingUnacknowledged(): Promise<WsDocument[]> {
    return this.rows(
      `SELECT * FROM documents
        WHERE missing_at IS NOT NULL
          AND (missing_dismissed_at IS NULL OR missing_dismissed_at < missing_at)
        ORDER BY missing_at DESC, id DESC`,
    ).map((r) => this.toDoc(r))
  }

  async setPinned(documentId: number, pinned: boolean): Promise<void> {
    this.run(`UPDATE documents SET pinned = ? WHERE id = ?`, [pinned ? 1 : 0, documentId])
  }

  async listPinned(): Promise<WsDocument[]> {
    return this.rows(`SELECT * FROM documents WHERE pinned = 1 ORDER BY title`).map((r) =>
      this.toDoc(r),
    )
  }

  async resetStuckIndexing(): Promise<number> {
    return this.rows(
      `UPDATE documents SET status = 'failed' WHERE status IN ('indexing', 'pending') RETURNING id`,
    ).length
  }

  /** Documents with a per-document aggregate language (dominant ≥70% → de/en,
   *  mixed otherwise, null when nothing detected). */
  async listDocuments(): Promise<WsDocument[]> {
    return this.rows(
      `
      SELECT d.*, (
        SELECT CASE
          WHEN SUM(c.language IS NOT NULL) = 0 THEN NULL
          WHEN CAST(SUM(c.language = 'de') AS REAL) / SUM(c.language IS NOT NULL) >= 0.7 THEN 'de'
          WHEN CAST(SUM(c.language = 'en') AS REAL) / SUM(c.language IS NOT NULL) >= 0.7 THEN 'en'
          ELSE 'mixed'
        END FROM chunks c WHERE c.document_id = d.id
      ) AS language
      FROM documents d ORDER BY d.added_at DESC`,
    ).map((r) => this.toDoc(r))
  }

  async listDocumentTitles(): Promise<Array<{ id: number; title: string }>> {
    return this.rows(`SELECT id, title FROM documents WHERE status = 'ready'`).map((r) => ({
      id: Number(r.id),
      title: String(r.title),
    }))
  }

  async getCitedChunkSource(chunkId: number): Promise<{
    document: WsDocument
    pageFrom: number | null
    pageTo: number | null
    headingPath: string[] | null
  } | null> {
    const row = this.one(
      `SELECT d.*, c.page_from AS c_page_from, c.page_to AS c_page_to, c.heading_path AS c_heading_path
         FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ? LIMIT 1`,
      [chunkId],
    )
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
    this.run(
      `UPDATE documents SET summary = ?, summary_embedding = NULL, summary_embedder_identity = NULL WHERE id = ?`,
      [summary, documentId],
    )
  }

  async setSummaryEmbedding(documentId: number, vector: number[], identity: string): Promise<void> {
    this.run(
      `UPDATE documents SET summary_embedding = ?, summary_embedder_identity = ? WHERE id = ?`,
      [f32ToBlob(vector), identity, documentId],
    )
  }

  async listDocsMissingSummaryEmbedding(
    limit: number,
  ): Promise<Array<{ id: number; summary: string }>> {
    return this.rows(
      `SELECT id, summary FROM documents
        WHERE status = 'ready' AND summary IS NOT NULL AND summary_embedding IS NULL
        ORDER BY id LIMIT ?`,
      [limit],
    ).map((r) => ({ id: Number(r.id), summary: String(r.summary) }))
  }

  async countDocsMissingSummaryEmbedding(): Promise<number> {
    return Number(
      this.one(
        `SELECT count(*) AS n FROM documents WHERE status = 'ready' AND summary IS NOT NULL AND summary_embedding IS NULL`,
      )!.n,
    )
  }

  async distinctSummaryEmbedderIdentities(): Promise<string[]> {
    return this.rows(
      `SELECT DISTINCT summary_embedder_identity AS i FROM documents
        WHERE summary_embedding IS NOT NULL AND summary_embedder_identity IS NOT NULL`,
    ).map((r) => String(r.i))
  }

  async purgeSummaryEmbeddingsByIdentity(identity: string): Promise<number> {
    return this.rows(
      `UPDATE documents SET summary_embedding = NULL, summary_embedder_identity = NULL
        WHERE summary_embedder_identity = ? RETURNING id`,
      [identity],
    ).length
  }

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
    const scored: Array<{ id: number; score: number }> = []
    for (const row of this.rows(
      `SELECT id, summary_embedding FROM documents WHERE status = 'ready' AND summary_embedding IS NOT NULL`,
    )) {
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
    const hits = new Map<number, number>()
    const match = toMatchQuery(themeTokens.join(' '))
    if (match) {
      for (const row of this.rows(
        `SELECT c.document_id AS did, count(*) AS n
           FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
           JOIN documents d ON d.id = c.document_id
          WHERE chunks_fts MATCH ? AND d.status = 'ready'
          GROUP BY c.document_id`,
        [match],
      )) {
        hits.set(Number(row.did), Number(row.n))
      }
    }
    const needles = themeTokens.map((t) => t.toLowerCase())
    const threshold = opts.similarityThreshold ?? 0.2
    const useEmb = !!(opts.themeEmbedding && opts.themeEmbedding.length > 0)
    const out: Array<{
      id: number
      title: string
      chunkHits: number
      firstChunkId: number | null
    }> = []
    for (const row of this.rows(
      `SELECT id, title, lower(title) AS lt, lower(COALESCE(summary, '')) AS ls, summary_embedding,
              (SELECT id FROM chunks WHERE document_id = documents.id ORDER BY ordinal LIMIT 1) AS first_chunk_id
         FROM documents WHERE status = 'ready'`,
    )) {
      const id = Number(row.id)
      if (active && !active.has(id)) continue
      const h = hits.get(id) ?? 0
      const lt = String(row.lt)
      const ls = String(row.ls)
      let member =
        needles.length === 0 || h > 0 || needles.some((n) => lt.includes(n) || ls.includes(n))
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

  // ---- chunks -------------------------------------------------------------

  /** Inserts chunks (FTS synced via triggers) and returns their ids in input
   *  order, so the caller can upsert vectors into LanceDB + mark them embedded. */
  async persistChunks(documentId: number, items: NewChunk[]): Promise<number[]> {
    if (items.length === 0) return []
    const insert = this.db.prepare(
      `INSERT INTO chunks (document_id, ordinal, text, token_count, page_from, page_to, heading_path, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    const txn = this.db.transaction((rows: NewChunk[]): number[] => {
      const ids: number[] = []
      for (const c of rows) {
        const r = insert.get(
          documentId,
          c.ordinal,
          c.text.split('\u0000').join(''),
          c.tokenCount,
          c.pageFrom,
          c.pageTo,
          c.headingPath ? JSON.stringify(c.headingPath) : null,
          c.language ?? null,
        ) as { id: number }
        ids.push(Number(r.id))
      }
      this.run(
        `UPDATE documents SET chunk_count = (SELECT count(*) FROM chunks WHERE document_id = ?) WHERE id = ?`,
        [documentId, documentId],
      )
      return ids
    })
    return txn(items)
  }

  async chunkIdsForDocument(documentId: number): Promise<number[]> {
    return this.rows(`SELECT id FROM chunks WHERE document_id = ?`, [documentId]).map((r) =>
      Number(r.id),
    )
  }

  async listChunksForDocument(documentId: number): Promise<ChunkRow[]> {
    return this.rows(
      `SELECT id, document_id, ordinal, text, token_count, page_from, page_to, heading_path, language
         FROM chunks WHERE document_id = ? ORDER BY ordinal`,
      [documentId],
    ).map((r) => this.toChunkRow(r))
  }

  async getChunkCounts(documentIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>()
    if (documentIds.length === 0) return map
    for (const row of this.rows(
      `SELECT document_id AS did, count(*) AS n FROM chunks
        WHERE document_id IN (${documentIds.map(() => '?').join(',')}) GROUP BY document_id`,
      documentIds.map((n) => Math.trunc(n)),
    )) {
      map.set(Number(row.did), Number(row.n))
    }
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
    return this.rows(
      `WITH t AS (SELECT document_id, ordinal FROM chunks WHERE id = ?)
       SELECT c.id, c.document_id, c.ordinal, c.text, c.token_count, c.page_from, c.page_to,
              (c.id = ?) AS is_target
         FROM chunks c, t
        WHERE c.document_id = t.document_id AND c.ordinal BETWEEN t.ordinal - ? AND t.ordinal + ?
        ORDER BY c.ordinal`,
      [chunkId, chunkId, before, after],
    ).map((row) => ({
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
    const args: SqlArg[] = []
    for (const s of seeds) args.push(s.documentId, s.ordinal - radius, s.ordinal + radius)
    return this.rows(
      `SELECT DISTINCT c.id, c.document_id, c.ordinal, c.text, c.token_count, c.page_from,
              c.page_to, c.heading_path, c.language
         FROM chunks c WHERE ${clauses} ORDER BY c.document_id, c.ordinal`,
      args,
    ).map((r) => this.toChunkRow(r))
  }

  // ---- embedding bookkeeping (vectors live in LanceDB; marker only here) ---

  async countChunksMissingEmbedding(): Promise<number> {
    return Number(this.one(`SELECT count(*) AS n FROM chunks WHERE embedded = 0`)!.n)
  }

  async listChunksMissingEmbedding(
    limit: number,
  ): Promise<Array<{ id: number; text: string; document_id: number }>> {
    return this.rows(
      `SELECT id, text, document_id FROM chunks WHERE embedded = 0 ORDER BY id LIMIT ?`,
      [limit],
    ).map((r) => ({ id: Number(r.id), text: String(r.text), document_id: Number(r.document_id) }))
  }

  async markChunksEmbedded(chunkIds: number[], identity: string): Promise<void> {
    if (chunkIds.length === 0) return
    this.run(
      `UPDATE chunks SET embedded = 1, embedder_identity = ?
        WHERE id IN (${chunkIds.map(() => '?').join(',')})`,
      [identity, ...chunkIds.map((n) => Math.trunc(n))],
    )
  }

  async resetEmbeddedMarkers(): Promise<number> {
    return this.rows(`UPDATE chunks SET embedded = 0 WHERE embedded = 1 RETURNING id`).length
  }

  async distinctEmbedderIdentities(): Promise<string[]> {
    return this.rows(`SELECT DISTINCT embedder_identity AS i FROM chunks WHERE embedded = 1`).map(
      (r) => String(r.i),
    )
  }

  async purgeEmbeddingsByIdentity(identity: string): Promise<number[]> {
    return this.rows(
      `UPDATE chunks SET embedded = 0 WHERE embedded = 1 AND embedder_identity = ? RETURNING id`,
      [identity],
    ).map((r) => Number(r.id))
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
    const args: SqlArg[] = [match]
    let docFilter = ''
    if (activeIds) {
      docFilter = ` AND c.document_id IN (${activeIds.map(() => '?').join(',')})`
      args.push(...activeIds.map((n) => Math.trunc(n)))
    }
    // bm25() may only be referenced where the query directly MATCHes the FTS
    // table — compute it once in `base`, then rank/cap over the plain column.
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
    return this.rows(sql, args).map((r) => this.toHit(r))
  }

  /** Hydrates LanceDB vector hits (chunkId+documentId+score) into full SearchHit
   *  rows, preserving incoming score order. Drops ids whose doc isn't 'ready'. */
  async hydrateChunkHits(
    scored: Array<{ chunkId: number; documentId: number; score: number }>,
  ): Promise<SearchHit[]> {
    if (scored.length === 0) return []
    const ids = scored.map((s) => Math.trunc(s.chunkId))
    const byId = new Map<number, SearchHit>()
    for (const row of this.rows(
      `SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS document_title,
              c.ordinal AS ordinal, c.page_from AS page_from, c.page_to AS page_to,
              c.heading_path AS heading_path, c.text AS text, c.language AS language, d.added_at AS added_at
         FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.id IN (${ids.map(() => '?').join(',')}) AND d.status = 'ready'`,
      ids,
    )) {
      byId.set(Number(row.chunk_id), this.toHit(row))
    }
    const out: SearchHit[] = []
    for (const s of scored) {
      const hit = byId.get(Math.trunc(s.chunkId))
      if (hit) out.push({ ...hit, score: s.score })
    }
    return out
  }

  /** Library search (AP-6) ported to FTS5: content matches via bm25 + snippet()
   *  highlighting (⟦…⟧), plus a title-LIKE arm so a filename match surfaces even
   *  when FTS tokenisation won't split it. One row per document (best chunk).
   *  doc-type bucketing, type filter, and sort are applied in JS. */
  async searchLibrary(query: string, opts: LibrarySearchOptions = {}): Promise<LibrarySearchRow[]> {
    const cleaned = query.trim()
    if (!cleaned) return []
    const topK = opts.topK && opts.topK > 0 ? opts.topK : 50
    const sort = opts.sort ?? 'relevance'
    const typeSet = opts.types && opts.types.length > 0 ? new Set<string>(opts.types) : null

    // shared doc-level filters
    const filt: string[] = []
    const fargs: SqlArg[] = []
    if (opts.addedAfter != null) {
      filt.push('d.added_at >= ?')
      fargs.push(opts.addedAfter)
    }
    if (opts.minBytes != null) {
      filt.push('d.byte_size >= ?')
      fargs.push(opts.minBytes)
    }
    if (opts.maxBytes != null) {
      filt.push('d.byte_size <= ?')
      fargs.push(opts.maxBytes)
    }
    const filtSql = filt.length ? ' AND ' + filt.join(' AND ') : ''
    const ql = cleaned.toLowerCase()

    const byDoc = new Map<number, LibrarySearchRow>()
    const titleMatch = new Set<number>()

    // 1. content matches (FTS5), best chunk per document
    const match = toMatchQuery(cleaned)
    if (match) {
      const rows = this.rows(
        `WITH base AS (
           SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS document_title,
                  c.page_from AS page_from, c.page_to AS page_to, c.heading_path AS heading_path,
                  c.language AS language, d.added_at AS added_at, d.byte_size AS byte_size,
                  d.source_path AS source_path, bm25(chunks_fts) AS rank,
                  snippet(chunks_fts, 0, '⟦', '⟧', '…', 18) AS headline
             FROM chunks_fts
             JOIN chunks c    ON c.id = chunks_fts.rowid
             JOIN documents d ON d.id = c.document_id
            WHERE chunks_fts MATCH ? AND d.status = 'ready'${filtSql}),
         ranked AS (SELECT *, row_number() OVER (PARTITION BY document_id ORDER BY rank ASC) AS dr FROM base)
         SELECT * FROM ranked WHERE dr = 1`,
        [match, ...fargs],
      )
      for (const r of rows) {
        const id = Number(r.document_id)
        const title = String(r.document_title)
        if (title.toLowerCase().includes(ql)) titleMatch.add(id)
        byDoc.set(id, {
          chunk_id: Number(r.chunk_id),
          document_id: id,
          document_title: title,
          doc_type: docTypeOf(String(r.source_path)),
          page_from: r.page_from == null ? null : Number(r.page_from),
          page_to: r.page_to == null ? null : Number(r.page_to),
          heading_path: r.heading_path ? (JSON.parse(String(r.heading_path)) as string[]) : null,
          score: -Number(r.rank),
          added_at: r.added_at == null ? null : Number(r.added_at),
          byte_size: r.byte_size == null ? null : Number(r.byte_size),
          language: (r.language ?? null) as 'de' | 'en' | 'other' | null,
          headline: String(r.headline),
        })
      }
    }

    // 2. title-LIKE arm: documents whose filename/title matches (first chunk)
    const likeNeedle = '%' + ql.replace(/[\\%_]/g, '\\$&') + '%'
    for (const r of this.rows(
      `SELECT d.id AS document_id, d.title AS document_title, d.added_at AS added_at,
              d.byte_size AS byte_size, d.source_path AS source_path,
              c.id AS chunk_id, c.text AS text, c.page_from AS page_from, c.page_to AS page_to,
              c.heading_path AS heading_path, c.language AS language
         FROM documents d
         JOIN chunks c ON c.id = (SELECT id FROM chunks WHERE document_id = d.id ORDER BY ordinal LIMIT 1)
        WHERE d.status = 'ready' AND lower(d.title) LIKE ? ESCAPE '\\'${filtSql}`,
      [likeNeedle, ...fargs],
    )) {
      const id = Number(r.document_id)
      titleMatch.add(id)
      if (byDoc.has(id)) continue
      byDoc.set(id, {
        chunk_id: Number(r.chunk_id),
        document_id: id,
        document_title: String(r.document_title),
        doc_type: docTypeOf(String(r.source_path)),
        page_from: r.page_from == null ? null : Number(r.page_from),
        page_to: r.page_to == null ? null : Number(r.page_to),
        heading_path: r.heading_path ? (JSON.parse(String(r.heading_path)) as string[]) : null,
        score: 0,
        added_at: r.added_at == null ? null : Number(r.added_at),
        byte_size: r.byte_size == null ? null : Number(r.byte_size),
        language: (r.language ?? null) as 'de' | 'en' | 'other' | null,
        headline: String(r.text).replace(/\s+/g, ' ').slice(0, 240),
      })
    }

    let out = [...byDoc.values()]
    if (typeSet) out = out.filter((r) => typeSet.has(r.doc_type))
    out.sort((a, b) => {
      if (sort === 'filename')
        return a.document_title.toLowerCase().localeCompare(b.document_title.toLowerCase())
      if (sort === 'added') return (b.added_at ?? 0) - (a.added_at ?? 0)
      // relevance: title matches first, then score
      const at = titleMatch.has(a.document_id)
      const bt = titleMatch.has(b.document_id)
      if (at !== bt) return at ? -1 : 1
      return b.score - a.score
    })
    return out.slice(0, topK)
  }

  /** No-op: the legacy pgvector HNSW index. Vectors live in LanceDB now. */
  async ensureVectorIndex(): Promise<void> {}

  // ---- sync folders -------------------------------------------------------

  async getSyncFolders(): Promise<string[]> {
    return this.rows(`SELECT path FROM sync_folders ORDER BY path`).map((r) => String(r.path))
  }

  async setSyncFolders(folders: string[]): Promise<void> {
    const ins = this.db.prepare(`INSERT OR IGNORE INTO sync_folders (path) VALUES (?)`)
    this.db.transaction(() => {
      this.run(`DELETE FROM sync_folders`)
      for (const p of folders) ins.run(p)
    })()
  }

  // ---- quiz ---------------------------------------------------------------

  async createDeck(input: {
    name: string
    documentIds: number[]
    questionCount: number
    language: QuizLanguage
  }): Promise<QuizDeck> {
    const row = this.one(
      `INSERT INTO quiz_decks (name, document_ids, question_count, language)
       VALUES (?, ?, ?, ?)
       RETURNING id, name, document_ids, question_count, status, error, language, created_at`,
      [input.name, JSON.stringify(input.documentIds), input.questionCount, input.language],
    )
    return this.toDeck(row!)
  }

  async setDeckStatus(deckId: number, status: QuizDeckStatus, error: string | null): Promise<void> {
    this.run(`UPDATE quiz_decks SET status = ?, error = ? WHERE id = ?`, [status, error, deckId])
  }

  async updateDeckQuestionCount(deckId: number, questionCount: number): Promise<void> {
    this.run(`UPDATE quiz_decks SET question_count = ? WHERE id = ?`, [questionCount, deckId])
  }

  async resetStuckDecks(): Promise<number> {
    return this.rows(
      `UPDATE quiz_decks SET status = 'failed',
              error = 'Generation was interrupted (app closed or locked). Retry to regenerate.'
        WHERE status = 'generating' RETURNING id`,
    ).length
  }

  async getDeck(deckId: number): Promise<QuizDeck | null> {
    const row = this.one(
      `SELECT id, name, document_ids, question_count, status, error, language, created_at
         FROM quiz_decks WHERE id = ?`,
      [deckId],
    )
    return row ? this.toDeck(row) : null
  }

  async listDecks(): Promise<QuizDeckSummary[]> {
    return this.rows(
      `SELECT d.id, d.name, d.document_ids, d.question_count, d.status, d.error, d.language, d.created_at,
              COUNT(a.id) FILTER (WHERE a.finished_at IS NOT NULL) AS attempt_count,
              (SELECT score FROM quiz_attempts WHERE deck_id = d.id AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, id DESC LIMIT 1) AS last_score,
              (SELECT finished_at FROM quiz_attempts WHERE deck_id = d.id AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, id DESC LIMIT 1) AS last_finished_at
         FROM quiz_decks d LEFT JOIN quiz_attempts a ON a.deck_id = d.id
        GROUP BY d.id ORDER BY d.created_at DESC, d.id DESC`,
    ).map((row) => ({
      ...this.toDeck(row),
      attemptCount: Number(row.attempt_count ?? 0),
      lastScore: row.last_score == null ? null : Number(row.last_score),
      lastFinishedAt: row.last_finished_at == null ? null : Number(row.last_finished_at),
    }))
  }

  async deleteDeck(deckId: number): Promise<void> {
    this.run(`DELETE FROM quiz_decks WHERE id = ?`, [deckId])
  }

  async listQuestions(deckId: number): Promise<QuizQuestion[]> {
    return this.rows(
      `SELECT id, deck_id, ordinal, stem, options, correct_index, explanation, source_chunk_ids, theme_title
         FROM quiz_questions WHERE deck_id = ? ORDER BY ordinal ASC, id ASC`,
      [deckId],
    ).map((r) => this.toQuestion(r))
  }

  async getDeckWithQuestions(deckId: number): Promise<QuizDeckWithQuestions | null> {
    const deck = await this.getDeck(deckId)
    if (!deck) return null
    return { deck, questions: await this.listQuestions(deckId) }
  }

  async insertQuestions(deckId: number, items: NewQuizQuestion[]): Promise<void> {
    if (items.length === 0) return
    const ins = this.db.prepare(
      `INSERT INTO quiz_questions
        (deck_id, ordinal, stem, options, correct_index, explanation, source_chunk_ids, theme_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.db.transaction(() => {
      for (const q of items) {
        ins.run(
          deckId,
          q.ordinal,
          q.stem,
          JSON.stringify(q.options),
          q.correctIndex,
          q.explanation,
          JSON.stringify(q.sourceChunkIds),
          q.themeTitle,
        )
      }
    })()
  }

  async clearQuestions(deckId: number): Promise<void> {
    this.run(`DELETE FROM quiz_questions WHERE deck_id = ?`, [deckId])
  }

  async deleteAttempts(deckId: number): Promise<void> {
    this.run(`DELETE FROM quiz_attempts WHERE deck_id = ?`, [deckId])
  }

  async startAttempt(deckId: number): Promise<QuizAttempt> {
    const row = this.one(
      `INSERT INTO quiz_attempts (deck_id) VALUES (?)
       RETURNING id, deck_id, started_at, finished_at, score, answers`,
      [deckId],
    )
    return this.toAttempt(row!)
  }

  async finishAttempt(
    attemptId: number,
    answers: QuizAttemptAnswer[],
    score: number,
  ): Promise<QuizAttempt> {
    const row = this.one(
      `UPDATE quiz_attempts SET finished_at = unixepoch(), answers = ?, score = ?
        WHERE id = ?
       RETURNING id, deck_id, started_at, finished_at, score, answers`,
      [JSON.stringify(answers), score, attemptId],
    )
    return this.toAttempt(row!)
  }

  async listAttempts(deckId: number): Promise<QuizAttempt[]> {
    return this.rows(
      `SELECT id, deck_id, started_at, finished_at, score, answers
         FROM quiz_attempts WHERE deck_id = ?
        ORDER BY finished_at DESC NULLS LAST, started_at DESC, id DESC`,
      [deckId],
    ).map((r) => this.toAttempt(r))
  }

  async getAttempt(attemptId: number): Promise<QuizAttempt | null> {
    const row = this.one(
      `SELECT id, deck_id, started_at, finished_at, score, answers FROM quiz_attempts WHERE id = ?`,
      [attemptId],
    )
    return row ? this.toAttempt(row) : null
  }

  // ---- conversations / messages / citations ------------------------------

  async createConversation(
    title?: string | null,
    activeDocumentIds?: number[],
  ): Promise<ConversationRow> {
    const row = this.one(
      `INSERT INTO conversations (title, active_document_ids) VALUES (?, ?)
       RETURNING id, title, active_document_ids, created_at`,
      [title ?? null, JSON.stringify(activeDocumentIds ?? [])],
    )!
    return this.toConversation(row, Number(row.created_at), 0)
  }

  async setConversationTitle(id: number, title: string | null): Promise<void> {
    this.run(`UPDATE conversations SET title = ? WHERE id = ?`, [title, id])
  }

  async setActiveDocumentIds(conversationId: number, ids: number[]): Promise<void> {
    this.run(`UPDATE conversations SET active_document_ids = ? WHERE id = ?`, [
      JSON.stringify(ids),
      conversationId,
    ])
  }

  async listConversations(): Promise<ConversationRow[]> {
    return this.rows(
      `SELECT c.id, c.title, c.active_document_ids, c.created_at,
              COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
              COUNT(m.id) AS message_count
         FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id ORDER BY last_activity_at DESC, c.id DESC`,
    ).map((row) =>
      this.toConversation(row, Number(row.last_activity_at), Number(row.message_count)),
    )
  }

  async deleteConversation(id: number): Promise<void> {
    this.run(`DELETE FROM conversations WHERE id = ?`, [id])
  }

  async deleteMessage(messageId: number): Promise<void> {
    this.run(`DELETE FROM messages WHERE id = ?`, [messageId])
  }

  async appendMessage(
    conversationId: number,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metrics?: { ttftMs: number | null; tokensPerSec: number | null; tokenCount: number | null },
  ): Promise<MessageRow> {
    const row = this.one(
      `INSERT INTO messages (conversation_id, role, content, ttft_ms, tokens_per_sec, token_count)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, conversation_id, role, content, created_at, ttft_ms, tokens_per_sec, token_count`,
      [
        conversationId,
        role,
        content,
        metrics?.ttftMs ?? null,
        metrics?.tokensPerSec ?? null,
        metrics?.tokenCount ?? null,
      ],
    )
    return this.toMessage(row!)
  }

  async persistCitations(
    messageId: number,
    items: Array<{ chunk_id: number; score?: number | null }>,
  ): Promise<void> {
    if (items.length === 0) return
    const ins = this.db.prepare(
      `INSERT INTO citations (message_id, chunk_id, score) VALUES (?, ?, ?)`,
    )
    this.db.transaction(() => {
      for (const it of items) ins.run(messageId, it.chunk_id, it.score ?? null)
    })()
  }

  async getConversationWithMessages(
    conversationId: number,
  ): Promise<{ conversation: ConversationRow; messages: MessageWithCitations[] } | null> {
    const c = this.one(
      `SELECT c.id, c.title, c.active_document_ids, c.created_at,
              COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
              COUNT(m.id) AS message_count
         FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.id = ? GROUP BY c.id`,
      [conversationId],
    )
    if (!c || c.id == null) return null
    const conversation = this.toConversation(c, Number(c.last_activity_at), Number(c.message_count))
    const messages: MessageWithCitations[] = this.rows(
      `SELECT id, conversation_id, role, content, created_at, ttft_ms, tokens_per_sec, token_count
         FROM messages WHERE conversation_id = ? ORDER BY id`,
      [conversationId],
    ).map((r) => ({ ...this.toMessage(r), citations: [] as CitationRow[] }))
    if (messages.length > 0) {
      // document_id is derived via JOIN chunks (the citations table only stores
      // chunk_id), mirroring the legacy PGlite getWithMessages shape so the chat
      // history renderer keeps showing per-message sources.
      const byMessage = new Map<number, CitationRow[]>()
      for (const m of messages) byMessage.set(m.id, m.citations)
      const placeholders = messages.map(() => '?').join(',')
      const citRows = this.rows(
        `SELECT cit.id AS id, cit.message_id AS message_id, cit.chunk_id AS chunk_id,
                ch.document_id AS document_id, cit.score AS score,
                cit.span_start AS span_start, cit.span_end AS span_end,
                cit.created_at AS created_at
           FROM citations cit
           JOIN chunks ch ON ch.id = cit.chunk_id
          WHERE cit.message_id IN (${placeholders})
          ORDER BY cit.id`,
        messages.map((m) => m.id),
      )
      for (const row of citRows) {
        const list = byMessage.get(Number(row.message_id))
        if (!list) continue
        list.push({
          id: Number(row.id),
          messageId: Number(row.message_id),
          chunkId: Number(row.chunk_id),
          documentId: Number(row.document_id),
          score: row.score == null ? null : Number(row.score),
          spanStart: row.span_start == null ? null : Number(row.span_start),
          spanEnd: row.span_end == null ? null : Number(row.span_end),
          createdAt: Number(row.created_at),
        })
      }
    }
    return { conversation, messages }
  }

  // ---- row mappers --------------------------------------------------------

  private toDoc(row: Row): WsDocument {
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

  private toChunkRow(row: Row): ChunkRow {
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

  private toConversation(row: Row, lastActivityAt: number, messageCount: number): ConversationRow {
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

  private toMessage(row: Row): MessageRow {
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

  private toDeck(row: Row): QuizDeck {
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

  private toQuestion(row: Row): QuizQuestion {
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

  private toAttempt(row: Row): QuizAttempt {
    return {
      id: Number(row.id),
      deckId: Number(row.deck_id),
      startedAt: Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      score: row.score == null ? null : Number(row.score),
      answers: row.answers ? (JSON.parse(String(row.answers)) as QuizAttemptAnswer[]) : [],
    }
  }

  private toHit(row: Row): SearchHit {
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
