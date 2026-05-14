import { app } from 'electron'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema'
import { recoveryTable, userTable } from './schema'

export type Db = PgliteDatabase<typeof schema>

function resolveMigrationsFolder(): string {
  // Packaged build ships the ./drizzle folder via electron-builder's
  // extraResources so it lands under process.resourcesPath. In dev,
  // app.getAppPath() resolves to the repo root.
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'drizzle')
}

/**
 * Owns the PGlite + Drizzle pair for a single unlocked session.
 *
 * The DB is in-memory because durable persistence is the encrypted snapshot
 * (`pgdata.snapshot.enc`), not a directory on disk. On login the snapshot is
 * decrypted, fed into `loadDataDir`, and PGlite picks up where the previous
 * session left off. On lock/logout, AuthService calls `dump()`, encrypts the
 * result, and writes it back.
 */
export class Database {
  private constructor(
    private readonly client: PGlite,
    private readonly drizzleDb: Db,
  ) {}

  /**
   * Creates an in-memory PGlite instance. If `loadFromBlob` is provided, the
   * blob (a previous `dump()` output) seeds the data directory before
   * migrations run. Migrations are idempotent — running them on a restored
   * snapshot is a no-op when the schema hasn't moved.
   *
   * @param _dataDir reserved; pass `undefined` (in-memory is the only supported mode)
   * @param loadFromBlob optional snapshot blob from a previous `dump()`
   */
  static async create(_dataDir: string | undefined, loadFromBlob?: Blob): Promise<Database> {
    const client = loadFromBlob ? new PGlite({ loadDataDir: loadFromBlob }) : new PGlite()
    await client.waitReady
    const drizzleDb = drizzle(client, { schema })
    await migrate(drizzleDb, { migrationsFolder: resolveMigrationsFolder() })
    return new Database(client, drizzleDb)
  }

  /** Serialises the live DB to a tar Blob ready for AES-GCM encryption. */
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
   * Re-seeds the `users` + `recovery_codes` rows from the auth.json source of
   * truth. AuthService calls this on register/reset so the SQL side stays in
   * sync with the wrapped-DEK envelopes. The `passwordHash` / `codeHash`
   * columns store a placeholder marker — verification always goes through the
   * wrapped-DEK unwrap, never through the SQL row.
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
