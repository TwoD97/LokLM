import { app } from 'electron'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema'
import { recoveryTable, userTable } from './schema'

export type Db = PgliteDatabase<typeof schema>

function resolveMigrationsFolder(): string {
  // packaged build ships the ./drizzle folder via electron-builder's
  // extraResources so it lands under process.resourcesPath. in dev ,
  // app.getAppPath() points at the repo root.
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'drizzle')
}

/**
 * owns the PGlite + Drizzle pair for one unlocked session.
 *
 * the DB is in-memory because durable persistence is the encrypted snapshot
 * inside the vault file , not a directory on disk. on login the snapshot is
 * decrypted , fed into `loadDataDir` , and PGlite picks up where the previous
 * session left off. on lock/logout AuthService calls `dump()` , encrypts the
 * result , and writes it back.
 */
export class Database {
  private constructor(
    private readonly client: PGlite,
    private readonly drizzleDb: Db,
  ) {}

  /**
   * creates an in-memory PGlite instance. if `loadFromBlob` is provided , the
   * blob (a previous `dump()` output) seeds the data directory before
   * migrations run. migrations are idempotent so running them on a restored
   * snapshot is a no-op when the schema hasnt moved.
   *
   * @param _dataDir reserved , pass `undefined` (in-memory is the only mode we support)
   * @param loadFromBlob optional snapshot blob from a previous `dump()`
   */
  static async create(_dataDir: string | undefined, loadFromBlob?: Blob): Promise<Database> {
    const client = loadFromBlob ? new PGlite({ loadDataDir: loadFromBlob }) : new PGlite()
    await client.waitReady
    const drizzleDb = drizzle(client, { schema })
    await migrate(drizzleDb, { migrationsFolder: resolveMigrationsFolder() })
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

  /**
   * re-seeds the `users` + `recovery_codes` rows from the vault header (the
   * real source of truth). AuthService calls this on register/reset so the
   * SQL side stays in sync with the wrapped-DEK envelopes. the `passwordHash`
   * / `codeHash` columns just store a placeholder , we never verify against
   * them , always through the wrapped-DEK unwrap.
   */
  async replaceAuthRows(input: {
    displayName: string
    passwordHash: string
    recoveryHashes: { hash: string; createdAt: number; usedAt: number | null }[]
  }): Promise<void> {
    await this.drizzleDb.transaction(async (tx) => {
      await tx.delete(recoveryTable)
      await tx.delete(userTable)
      const inserted = await tx
        .insert(userTable)
        .values({
          displayName: input.displayName,
          passwordHash: input.passwordHash,
        })
        .returning({ id: userTable.id })
      const user = inserted[0]
      if (!user) throw new Error('replaceAuthRows: user insert returned no row')
      for (const r of input.recoveryHashes) {
        await tx.insert(recoveryTable).values({
          userId: user.id,
          codeHash: r.hash,
          createdAt: r.createdAt,
          usedAt: r.usedAt,
        })
      }
    })
  }
}

export { schema }
