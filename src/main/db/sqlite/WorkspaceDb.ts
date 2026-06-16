import { createClient, type Client, type InArgs } from '@libsql/client'
import { WORKSPACE_SCHEMA_SQL } from './schema.sql'
import type { SearchHit, ChunkSearchOptions } from '../database'

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
}

export interface DocumentRow {
  id: number
  title: string
  source_path: string
  status: string
  workspace_id?: number
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
  private constructor(private readonly client: Client) {}

  /** Opens (creating + migrating) a workspace's encrypted libSQL file. `keyHex`
   *  is the workspace WDEK as hex (libSQL takes a string encryptionKey). */
  static async open(filePath: string, keyHex: string): Promise<WorkspaceDb> {
    const client = createClient({ url: `file:${filePath}`, encryptionKey: keyHex })
    await client.executeMultiple(WORKSPACE_SCHEMA_SQL)
    return new WorkspaceDb(client)
  }

  close(): void {
    this.client.close()
  }

  /** Raw client — for repos/services not yet ported off PGlite. */
  get raw(): Client {
    return this.client
  }

  // ---- documents ----------------------------------------------------------

  async addDocument(input: NewDocumentInput): Promise<DocumentRow> {
    const r = await this.client.execute({
      sql: `INSERT INTO documents (title, source_path, mime_type, byte_size, status)
            VALUES (?, ?, ?, ?, ?) RETURNING id, title, source_path, status`,
      args: [
        input.title,
        input.sourcePath,
        input.mimeType ?? null,
        input.byteSize ?? null,
        input.status ?? 'pending',
      ],
    })
    return r.rows[0] as unknown as DocumentRow
  }

  async getDocument(id: number): Promise<DocumentRow | null> {
    const r = await this.client.execute({
      sql: `SELECT id, title, source_path, status FROM documents WHERE id = ?`,
      args: [id],
    })
    return (r.rows[0] as unknown as DocumentRow) ?? null
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

  async persistChunks(documentId: number, items: NewChunk[]): Promise<void> {
    if (items.length === 0) return
    const stmts = items.map((c) => ({
      sql: `INSERT INTO chunks (document_id, ordinal, text, token_count, page_from, page_to, heading_path, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    await this.client.batch(stmts, 'write')
    await this.client.execute({
      sql: `UPDATE documents SET chunk_count = (SELECT count(*) FROM chunks WHERE document_id = ?) WHERE id = ?`,
      args: [documentId, documentId],
    })
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
