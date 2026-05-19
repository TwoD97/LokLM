# Transaktionale DB-Tests

Diese Ebene prüft Datenbankoperationen mit `BEGIN/ROLLBACK`-Isolation: jeder
Test bekommt eine eigene Transaktion, am Ende wird rollbackt, der nächste Test
sieht einen sauberen Zustand.

## Warum überhaupt

Wenn echte Tabellen landen (Dokumente, Chats, Embeddings) brauchen wir Tests,
die mehrere Inserts/Updates kombinieren, Constraints auslösen und Edge-Cases
abdecken. Ohne Isolation kontaminiert ein Test den nächsten und Fehler werden
schwer reproduzierbar.

Die PGlite-Instanz selbst ist in-memory, also könnte man pro Test eine neue
hochfahren. Macht man das aber für jeden Test einzeln, kostet die
Initialisierung mehr als der eigentliche Test. Eine geteilte Instanz mit
`BEGIN/ROLLBACK` pro Test ist schneller _und_ realistischer (Migrations werden
nur einmal angewendet).

## Wie der Helper funktioniert

[`helpers/withTransaction.ts`](./helpers/withTransaction.ts) liefert eine
geteilte PGlite-Instanz und einen `withTransaction`-Wrapper. Beispiel:

```ts
import { describe, it, beforeAll, afterAll } from 'vitest'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'

describe('documents', () => {
  beforeAll(setupDb)
  afterAll(teardownDb)

  it('rejects insert without title', async () => {
    await withTransaction(async (tx) => {
      // ... queries gegen tx
      // rollback geschieht automatisch nach dem callback
    })
  })
})
```

## Status

Aktuell ist `src/main/db/schema.ts` leer (siehe Kommentar dort). Sobald die
erste reale Tabelle landet:

1. `pnpm db:generate` ausführen, damit `drizzle/<n>_<tag>.sql` entsteht.
2. `migrate()` in der Helper-`setupDb` aufrufen, damit die Tabellen in der
   geteilten Instanz angelegt werden.
3. Den Platzhalter [`example.test.ts`](./example.test.ts) durch echte Tests
   ersetzen oder ergänzen.

## Konventionen

- Dateinamen: `*.test.ts`.
- Schema-Änderungen gehören in `src/main/db/schema.ts` plus generierte
  Migration in `drizzle/`. Tests greifen darauf zu, definieren _kein_ eigenes
  Schema.
- Tests laufen sequentiell (single PGlite-Instanz). Parallel-Mode kann pro
  Worker eine eigene Instanz nutzen, aber das ist erst nötig wenn der Layer
  langsam wird.
