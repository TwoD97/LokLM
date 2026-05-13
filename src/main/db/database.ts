import { app } from 'electron'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema'

export type Db = PgliteDatabase<typeof schema>

let client: PGlite | null = null
let db: Db | null = null
let initPromise: Promise<Db> | null = null

function resolveMigrationsFolder(): string {
  // In packaged builds, ship the ./drizzle folder via electron-builder's
  // extraResources so it lands under process.resourcesPath. In dev,
  // app.getAppPath() resolves to the repo root.
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'drizzle')
}

function resolveDataDir(): string {
  return path.join(app.getPath('userData'), 'loklm-db')
}

export async function getDb(): Promise<Db> {
  if (db) return db
  if (initPromise) return initPromise

  initPromise = (async () => {
    await app.whenReady()

    client = new PGlite(resolveDataDir())
    db = drizzle(client, { schema })

    await migrate(db, { migrationsFolder: resolveMigrationsFolder() })

    return db
  })()

  return initPromise
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close()
    client = null
    db = null
    initPromise = null
  }
}

export { schema }
