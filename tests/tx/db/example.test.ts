import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'

// platzhalter-test gegen leeres schema. zeigt das pattern und stellt sicher
// dass die PGlite-instanz hochkommt und transaktionen funktionieren.
// sobald reale tabellen landen , wird das hier durch echte tests ersetzt
// (insert/select/constraint-violation/foreign-key-cascade etc.).

describe('db transactions (example)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('läuft eine triviale query in einer tx', async () => {
    await withTransaction(async (tx) => {
      const result = await tx.execute(sql`SELECT 1 AS one`)
      const row = (result.rows as unknown as Array<{ one: number }>)[0]
      expect(row?.one).toBe(1)
    })
  })

  it('rollback isoliert tests voneinander', async () => {
    // tx A: legt temp-table an und schreibt rein
    await withTransaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE t (n int) ON COMMIT DROP`)
      await tx.execute(sql`INSERT INTO t VALUES (42)`)
      const result = await tx.execute(sql`SELECT count(*)::int AS c FROM t`)
      const row = (result.rows as unknown as Array<{ c: number }>)[0]
      expect(row?.c).toBe(1)
    })

    // tx B: sieht die temp-table nicht , weil tx A rollbackt wurde
    await withTransaction(async (tx) => {
      const result = await tx.execute(sql`SELECT to_regclass('pg_temp.t') IS NULL AS gone`)
      const row = (result.rows as unknown as Array<{ gone: boolean }>)[0]
      expect(row?.gone).toBe(true)
    })
  })
})
