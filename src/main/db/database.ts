import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import * as schema from './schema'

export type Db = PgliteDatabase<typeof schema>

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
    const client = loadFromBlob ? new PGlite({ loadDataDir: loadFromBlob }) : new PGlite()
    await client.waitReady
    const drizzleDb = drizzle(client, { schema })
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
}

export { schema }
