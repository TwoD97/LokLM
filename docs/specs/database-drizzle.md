# Database (Drizzle + PGlite)

LokLM ships an embedded Postgres-compatible database via [PGlite](https://github.com/electric-sql/pglite) and accesses it through [Drizzle ORM](https://orm.drizzle.team). The database lives entirely inside the Electron main process — there is no external Postgres server.

## Mental model

Three things, in priority order:

1. **`src/main/db/schema.ts` is the single source of truth.** TypeScript table definitions.
2. **`./drizzle/*.sql` are generated artifacts.** Migrations produced by diffing the schema against the previous snapshot. Reviewed by humans, committed to git, applied automatically at startup.
3. **Types are inferred.** No hand-written interfaces for table rows. Drizzle's `$inferSelect` / `$inferInsert` derive them from the table object.

Never edit migration files by hand. Never hand-roll table types. Change the schema; the rest follows.

## File layout

| Path | Role |
| --- | --- |
| `src/main/db/schema.ts` | Table + index + constraint definitions. Source of truth. |
| `src/main/db/database.ts` | Opens PGlite, runs migrations, exports `getDb()` / `closeDb()`. |
| `drizzle.config.ts` | Drizzle Kit CLI config (schema path + output dir + dialect). |
| `drizzle/0000_*.sql` | Generated migrations, applied in filename order. |
| `drizzle/meta/` | Drizzle's internal snapshots — required for diffing. Commit it. |

## Daily workflow

### 1. Change the schema

Edit `src/main/db/schema.ts` — add a column, add a table, add an index, change a constraint.

### 2. Generate a migration

```sh
pnpm db:generate
```

Drizzle Kit diffs the schema against the previous snapshot under `drizzle/meta/` and writes a new `drizzle/NNNN_<name>.sql` plus an updated snapshot. **Read the generated SQL** — Drizzle's diffs are normally fine, but renames are detected as drop+add by default. If you see an accidental drop, fix the schema or split the change.

### 3. Commit together

`schema.ts`, the new `drizzle/NNNN_*.sql`, and the updated `drizzle/meta/*` all go in the same commit. They describe one logical change; splitting them creates a broken intermediate state.

### 4. Run the app

Next launch, `getDb()` applies pending migrations against the local PGlite DB before any service queries it. No CLI step.

## Using the database in code

```ts
import { getDb, schema } from '@/main/db/database'
import { eq } from 'drizzle-orm'

const db = await getDb()

// Insert
const [user] = await db
  .insert(schema.userTable)
  .values({ displayName: 'alice', passwordHash: hash })
  .returning()

// Select
const row = await db
  .select()
  .from(schema.userTable)
  .where(eq(schema.userTable.id, user.id))
  .limit(1)
```

`getDb()` returns the same instance on subsequent calls. Don't cache it in module-level variables in service files — just call `getDb()` where you need it.

## Types

Drizzle infers row types from the table object:

```ts
import { userTable } from '@/main/db/schema'

type User = typeof userTable.$inferSelect      // shape returned by SELECT
type NewUser = typeof userTable.$inferInsert   // shape accepted by INSERT
```

`schema.ts` already exports `User`, `NewUser`, `RecoveryCode`, `NewRecoveryCode` for convenience. For tables added later, either add similar exports or use `$inferSelect`/`$inferInsert` at the call site.

The two types differ in important ways:

- Columns with defaults (e.g. `createdAt`, identity `id`) are **required** in `User` but **optional** in `NewUser`.
- Nullable columns (e.g. `usedAt`) are `T | null` in `User` and `T | null | undefined` in `NewUser`.

Use `NewUser` for inserts; use `User` everywhere else.

## Startup migration

`getDb()` in `src/main/db/database.ts`:

1. Awaits `app.whenReady()` so Electron paths are resolved.
2. Opens PGlite against `<userData>/loklm-db` (a directory — PGlite stores multiple files there).
3. Wraps it with Drizzle.
4. Runs `migrate()` against the bundled `./drizzle` folder.
5. Caches the instance.

Concurrency: the function memoizes the initialization promise, so simultaneous callers all await the same migration run.

### Where the DB file lives

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\LokLM\loklm-db\` |
| macOS | `~/Library/Application Support/LokLM/loklm-db/` |
| Linux | `~/.config/LokLM/loklm-db/` |

### Packaging note

For the migrations folder to resolve in a packaged build, `./drizzle` must be shipped as an [`extraResources`](https://www.electron.build/configuration/contents#extraresources) entry in your electron-builder config so it lands under `process.resourcesPath`. Example fragment for when the build is set up:

```json
{
  "build": {
    "extraResources": [
      { "from": "drizzle", "to": "drizzle" }
    ]
  }
}
```

`database.ts` already chooses between `app.getAppPath()` (dev) and `process.resourcesPath` (packaged) automatically.

## Inspecting the schema

```sh
pnpm db:studio
```

Opens Drizzle Studio at `https://local.drizzle.studio`. Useful for confirming a generated migration produced the schema you expected.

For inspecting *live data* in the embedded PGlite DB, the most direct route is the Electron devtools — temporarily expose `db` from the main process via IPC and run queries from a renderer console, or add a one-off debug script that opens the same directory and runs a query.

```sh
pnpm db:check
```

Verifies that migrations are internally consistent (no gaps, no duplicate hashes). Run after a rebase that touched migrations.

## Why there's no `db:migrate` script

The app self-migrates at startup against the user's data directory. A standalone `drizzle-kit migrate` would have to point at a different PGlite path (or none at all, since drizzle-kit's migrator was designed for connection-string Postgres). Adding the script would create two ways to apply migrations and a real risk of pointing at the wrong DB. Trust the startup path; if you need to test a migration in isolation, run the app.

## Troubleshooting

### Migration fails at startup

PGlite throws and the Electron app crashes during `getDb()`. Look at the main-process console — Drizzle prints the offending SQL and the Postgres error. Common causes:

- A `NOT NULL` column added without a default to a table that already has rows. Fix: add a default in the schema, regenerate.
- A check constraint that existing rows violate. Fix: write a data migration in SQL inside the same migration file, or relax the constraint.

After fixing `schema.ts`, regenerate (`pnpm db:generate`). For local dev, you may need to wipe the DB (next section).

### Reset the local dev DB

Delete the `loklm-db` directory inside your OS's user-data path (see the table above). Next launch, PGlite creates a fresh DB and applies all migrations from scratch.

**Don't do this in shipped builds.** End users have real data there.

### "Drift" between schema and migrations

If `pnpm db:check` complains, your `drizzle/meta/_journal.json` is out of sync with the migration files — usually from a rebase that took one side of a conflict incorrectly. Resolve by deleting the offending migration files + meta entries and regenerating from the current schema, or by restoring the missing files. Don't hand-edit `_journal.json`.

### Renames are detected as drop+add

Drizzle Kit can't read your mind. When renaming a column or table, it will prompt during `db:generate` whether the operation is a rename or a drop+add. Pick rename. If you missed the prompt and got a drop+add, delete the generated migration and regenerate.
