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
