import { migrate as drizzleMigrate } from 'drizzle-orm/pglite/migrator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './database'

// drizzle ships generated migrations from /drizzle. raw SQL extras live under
// src/main/db/migrations and are applied AFTER drizzle migrations.
//
// in dev: paths are relative to project root.
// in packaged builds: extraResources will copy both folders under
// process.resourcesPath; we'll wire extraResources when packaging this release.

const RAW_MIGRATIONS = ['0001_triggers_funcs.sql', '0002_hnsw_index.sql']

function isPackaged(): boolean {
  // detect packaged electron build without importing `app` (which throws in vitest)
  if (typeof process.versions.electron !== 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as { app: { isPackaged: boolean } }
      return app?.isPackaged ?? false
    } catch {
      return false
    }
  }
  return false
}

export async function runMigrations(db: Db): Promise<void> {
  const packaged = isPackaged()
  // db.$client is the raw PGlite instance; its .exec() handles multi-statement
  // SQL without going through the prepared-statement path that drizzle uses.
  const client = db.$client

  // vector extension must exist before drizzle migrations create the chunks
  // table (which uses vector(1024)). run it first, idempotent.
  await client.exec('CREATE EXTENSION IF NOT EXISTS vector')

  const drizzleDir = packaged
    ? join(process.resourcesPath, 'drizzle')
    : join(process.cwd(), 'drizzle')

  await drizzleMigrate(db, { migrationsFolder: drizzleDir })

  const rawDir = packaged
    ? join(process.resourcesPath, 'migrations')
    : join(process.cwd(), 'src/main/db/migrations')

  for (const file of RAW_MIGRATIONS) {
    const text = readFileSync(join(rawDir, file), 'utf8')
    await client.exec(text)
  }
}
