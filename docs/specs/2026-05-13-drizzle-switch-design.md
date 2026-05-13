# Finish the Drizzle Switch — Design

**Status:** approved
**Date:** 2026-05-13

## Goal

Complete the in-progress migration from raw SQL (`schema.sql` + a near-empty `datebase.ts`) to Drizzle ORM on top of `@electric-sql/pglite`, and document the workflow (use, migrate, generate types) so future schema changes are routine.

## Context

The project is an Electron desktop app (`LokLM`) using PGlite as an embedded, in-process Postgres. A switch to Drizzle was started but left half-done:

- `drizzle.config.ts` exists at repo root but points at the wrong schema path (`./src/db/schema.ts` instead of `./src/main/db/schema.ts`) and is shaped for an external `DATABASE_URL`.
- `src/main/db/schema.ts` declares `userTable` (with typos) and an incomplete, syntactically broken `recoveryTable`.
- `src/main/db/schema.sql` still exists as the original source of intent (but also has bugs).
- `src/main/db/datebase.ts` (filename typo) is a stub that imports PGlite + `schema.sql?raw` and does nothing.
- `AuthService.ts` imports `Database` from `../db/database` — a path that doesn't resolve given the filename typo.
- No migration files, no scripts, no docs.

## Architecture

**Single source of truth:** `src/main/db/schema.ts`. Everything else (migration SQL, TS types) is derived from it.

**Runtime stack:**

- `@electric-sql/pglite` opens a persistent database at `app.getPath('userData') + '/loklm.db'` so each OS user has an isolated DB at the conventional location.
- `drizzle-orm/pglite` wraps the PGlite client to produce the `db` handle used by services.
- On Electron `app.whenReady()` (before any service touches `db`), `drizzle-orm/pglite/migrator.migrate()` applies any pending migrations bundled at `./drizzle/`.

**Dev-time tooling:**

- `drizzle-kit generate` reads `schema.ts`, diffs it against the last snapshot in `./drizzle/meta/`, and emits a new SQL migration file. Reviewed and committed alongside the schema change.
- `drizzle-kit studio` opens a local browser UI to inspect the schema (works against the schema definition; live data inspection of an embedded PGlite is a known limitation we accept — `studio` can still verify the schema renders correctly).
- `drizzle-kit check` validates that migrations are consistent.

**Types:** Drizzle infers row types from the table definition. Consumers do:

```ts
import { userTable } from '@/main/db/schema'
type User = typeof userTable.$inferSelect
type NewUser = typeof userTable.$inferInsert
```

No hand-written types file. No code generation step beyond migrations.

## Changes

### 1. `drizzle.config.ts`

- Fix `schema` to `./src/main/db/schema.ts`.
- Switch to the PGlite-compatible config shape (`dialect: 'postgresql'`, no `dbCredentials.url`). The config exists only for the `generate`/`check`/`studio` CLI commands; runtime never reads it.
- Keep `out: './drizzle'`.

### 2. `src/main/db/schema.ts`

Rewrite to a clean, complete schema mirroring the intent of the old `schema.sql`:

- **`userTable`** (`users`):
  - `id` — serial primary key (use `integer().primaryKey().generatedAlwaysAsIdentity()`).
  - `displayName` — `varchar({ length: 32 }).notNull()` with a check constraint that length is between 3 and 32 (preserves the SQL-level invariant).
  - `passwordHash` — `text().notNull()`.
  - `createdAt` — `bigint({ mode: 'number' }).notNull().default(sql\`EXTRACT(EPOCH FROM NOW())::BIGINT\`)`.
- **`recoveryTable`** (`recovery_codes`):
  - `id` — serial primary key.
  - `userId` — `integer().notNull().references(() => userTable.id, { onDelete: 'cascade' })`.
  - `codeHash` — `text().notNull()`.
  - `createdAt` — same default pattern as above.
  - `usedAt` — `bigint({ mode: 'number' })` (nullable).
- **Index:** partial index on `recovery_codes(user_id) WHERE used_at IS NULL`, defined via Drizzle's `index()` builder with `.where(sql\`used_at IS NULL\`)`.
- Remove unused `serial` import.
- Export inferred types at the bottom: `User`, `NewUser`, `RecoveryCode`, `NewRecoveryCode`.

Column names in TS use camelCase; the underlying Postgres columns stay snake_case via Drizzle's name argument where they differ (e.g. `varchar('display_name', ...)`). This keeps SQL idiomatic without forcing snake_case property access in TS.

### 3. `src/main/db/database.ts` (renamed from `datebase.ts`)

Replace stub with a module that:

- Imports `PGlite`, `drizzle` from `drizzle-orm/pglite`, `migrate` from `drizzle-orm/pglite/migrator`, and `app` from `electron`.
- Resolves the DB path as `path.join(app.getPath('userData'), 'loklm.db')`.
- Lazily creates a singleton: `let client: PGlite | null; let db: PgliteDatabase | null;`.
- Exports `async function getDb()` that:
  1. If already initialized, returns `db`.
  2. Otherwise constructs the `PGlite` client, wraps it with `drizzle(client, { schema })`, runs `await migrate(db, { migrationsFolder: path.join(__dirname, '../../../drizzle') })`, and caches the result.
- Exports `async function closeDb()` that closes the underlying PGlite client (called on `app.before-quit`).
- Re-exports the full `schema` namespace for convenient query building.

The migrations folder path needs to resolve correctly both in dev (running from `src/`) and in a packaged Electron build. Standard fix: at packaging time, the `drizzle/` folder is included as an extra resource and resolved via `process.resourcesPath` when `app.isPackaged`. The implementation plan will spell this out.

### 4. Delete `src/main/db/schema.sql`

It's superseded. Drizzle owns the schema now.

### 5. `src/main/services/auth/AuthService.ts`

Only change: fix the import to `../../db/database` (currently `../db/database`, which is wrong even before the rename). Don't expand auth logic — that's out of scope for this task; the file is a stub.

### 6. `package.json` scripts

Add:

- `"db:generate": "drizzle-kit generate"`
- `"db:studio": "drizzle-kit studio"`
- `"db:check": "drizzle-kit check"`

No `db:migrate` script. The app self-migrates at startup; a separate CLI migrate would target a different DB file than the running app and create confusion. Documented in the troubleshooting section of the doc.

### 7. Generated initial migration

Run `pnpm db:generate` once to produce `./drizzle/0000_*.sql` and the meta snapshot. Commit both. These ship with the app so first-run users get the right schema applied.

### 8. Docs: `docs/superpowers/database-drizzle.md`

Single doc covering:

1. **Mental model** — schema.ts is truth; migrations are generated; types are inferred.
2. **Daily workflow** — edit schema → `pnpm db:generate` → inspect generated SQL → commit schema + migration + meta together.
3. **Using types in code** — `$inferSelect` / `$inferInsert` examples, importing tables for query building, named relations if/when added.
4. **Startup migration** — how `getDb()` resolves the migrations folder, where the DB file lives, what happens on first run.
5. **Inspection** — `pnpm db:studio` to view schema; for live data inspection of the embedded DB, point a PG client at the PGlite file or use the Electron devtools console with the exported `db` handle.
6. **Troubleshooting** — failed migration (PGlite throws; app crashes on boot — fix the SQL, regenerate); resetting local dev DB (delete the file under `userData`); common errors (drift between schema and migrations → `db:check`).

## Out of scope (YAGNI)

- Seed scripts.
- Multi-environment configs.
- Repository / data-access layer abstractions over Drizzle — services call `db` directly until duplication justifies an abstraction.
- Auth logic itself.
- Renderer-side DB access (main process only).

## Open questions

None — all critical decisions captured above.
