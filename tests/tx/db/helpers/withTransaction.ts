import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import * as schema from '@main/db/schema'

// geteilte PGlite + drizzle für alle tx-tests in einem prozess.
// initialisierung passiert in setupDb , teardown in teardownDb.
// jeder einzelne test läuft in einer eigenen tx die am ende rollbackt ,
// damit nichts zwischen tests leaked.
//
// migrations: sobald reale tabellen landen , hier `await migrate(db , { migrationsFolder: ... })`
// nach dem `drizzle(...)` aufruf einbauen.

let client: PGlite | null = null
let db: PgliteDatabase<typeof schema> | null = null

export async function setupDb(): Promise<void> {
  client = new PGlite()
  await client.waitReady
  db = drizzle(client, { schema })
  // TODO: migrate(db , { migrationsFolder: 'drizzle' }) sobald schema nicht mehr leer
}

export async function teardownDb(): Promise<void> {
  await client?.close()
  client = null
  db = null
}

export type Tx = Parameters<Parameters<PgliteDatabase<typeof schema>['transaction']>[0]>[0]

/**
 * führt den callback in einer transaktion aus und rollbackt am ende immer.
 * der rollback-fehler wird geschluckt , damit das eigentliche test-ergebnis
 * sichtbar bleibt.
 */
export async function withTransaction(fn: (tx: Tx) => Promise<void>): Promise<void> {
  if (!db) throw new Error('withTransaction: setupDb wurde nicht aufgerufen.')
  try {
    await db.transaction(async (tx) => {
      await fn(tx)
      // throw am ende erzwingt rollback , drizzle propagiert den fehler.
      // den sentinel fangen wir draussen wieder ab.
      throw new RollbackSentinel()
    })
  } catch (err) {
    if (!(err instanceof RollbackSentinel)) throw err
  }
}

class RollbackSentinel extends Error {
  constructor() {
    super('rollback')
    this.name = 'RollbackSentinel'
  }
}
