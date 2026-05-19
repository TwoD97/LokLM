# RAG Pipeline 2A — Embeddings + HNSW Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **Do NOT commit per task** — the controller batches everything into one final commit at the end (matches the user's commit cadence).

**Spec:** [Spec 2 — RAG Pipeline on AP-4.4 Outline](https://notes.ltwodl.com/doc/ap-44-rrf-fusion-in-retrievalservice-oV1wEBsVI0). This sub-plan covers **AP-4.3** only (BGE-M3 EmbeddingService + Backfill + HNSW). AP-4.2 query side, AP-4.4 RRF/rerank, AP-7.2 pipeline + prompt, AP-7.4 refusal land in sub-plans 2B and 2C.

**Branch:** `release/v0.2-rag` (already cut; Spec 1 committed in `f05c471`).

**Goal:** Land the embedding layer so every chunk in `chunks.embedding` is populated by a real BGE-M3 vector — both on import going forward and via a one-shot backfill for documents already in the vault.

**Architecture:** Bundled (well, downloaded — see Task 1) BGE-M3 GGUF loaded via `node-llama-cpp`'s embedding context. A `ResourcePlanner` chooses CPU vs GPU based on free VRAM. `EmbeddingService.embedPassages([...])` writes to `chunks.embedding` during import; `EmbeddingBackfillService.run(workspaceId)` walks NULL vectors and fills them after the embedder warms post-login. HNSW index `idx_chunks_hnsw` (cosine, m=16, ef_construction=64) is created lazily — idempotent migration on boot.

**Tech Stack:** TypeScript, `node-llama-cpp` ^3.18.1 (new), `@electric-sql/pglite` + `vector` extension (already present), Drizzle 0.45.

---

## File Structure

**New files:**
- `scripts/download-models.mjs` — downloads BGE-M3 GGUF into `models/`; tier-aware so 2B/2C can extend with reranker + LLM later
- `src/main/services/embeddings/ResourcePlanner.ts` — pure CPU/GPU placement helper (port verbatim from MVP, sans LLM-specific paths)
- `src/main/services/embeddings/EmbeddingService.ts` — BGE-M3 loader + `embedQuery` / `embedPassages` (port + retarget from arctic to BGE-M3)
- `src/main/services/embeddings/EmbeddingBackfillService.ts` — one-shot per-workspace backfill (port from MVP)
- `src/main/db/migrations/0002_hnsw_index.sql` — HNSW cosine index, idempotent
- `tests/tx/db/embedding-search.test.ts` — tx test: write 3 vectors, cosine-search returns nearest
- `tests/integration/embedding-backfill.test.ts` — integration test: import without embedder → start embedder → backfill fills NULLs

**Modified files:**
- `package.json` — add `node-llama-cpp` dependency + `models` / `models:embedder` scripts
- `src/main/db/database.ts` — extend `DocumentsRepo` with `countChunksMissingEmbedding`, `listChunksMissingEmbedding`, `setChunkEmbedding`, `ensureVectorIndex` methods
- `src/main/db/migrate.ts` — add `0002_hnsw_index.sql` to `RAW_MIGRATIONS` list
- `src/main/services/documents/DocumentService.ts` — wire embedding phase: pass embedder, call `embedder.embedPassages(chunks)` before persisting
- `src/main/services/documents/types.ts` — add `EmbedderStatus` / `BackfillStatus` re-exports (or keep in embeddings/ — your call)
- `src/main/index.ts` — instantiate `EmbeddingService` + `EmbeddingBackfillService` as memoised singletons; register IPC handlers `embedder:status`, `embedder:info`, `embedder:reload`, `embedder:setPlacement`, `embedder:backfillStatus`, `embedder:runBackfill`
- `src/preload/index.ts` — expose `window.api.embedder.*`
- `src/renderer/src/setupTests.ts` — stub embedder API for the web vitest project
- `src/shared/documents.ts` — add `EmbedderStatus` + `BackfillStatus` types for the renderer side
- `.gitignore` — `models/` is already ignored; verify

**Pre-existing files we read but don't modify:**
- `src/main/services/auth/AuthService.ts` — already has `requireDatabase()` we reuse
- `tests/tx/db/helpers/withTransaction.ts` — already wires migrations via `runMigrations`

---

## Pre-flight

- [ ] Confirm `git status` is clean on `release/v0.2-rag` (apart from untracked plan files).
- [ ] Confirm `pnpm install` succeeds against the lockfile.
- [ ] Confirm `pnpm test` runs 42/43 (the one pre-existing vault failure stays).

---

## Task 1: node-llama-cpp + models download script

**Files:**
- Modify: `package.json`
- Create: `scripts/download-models.mjs`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add node-llama-cpp@^3.18.1
```

Expected: installs `node-llama-cpp ^3.18.1` in `dependencies`. The package compiles native bits via prebuilds; pnpm should pick the right one for the host. If it fails with a build error, report — we may need `npm_config_node_gyp` or to skip post-install scripts.

- [ ] **Step 2: Verify the import works**

Run:
```bash
node -e "import('node-llama-cpp').then(m => console.log(Object.keys(m).slice(0,5)))"
```

Expected: prints an array including `getLlama`. No native-bindings-missing errors.

- [ ] **Step 3: Write `scripts/download-models.mjs`**

Adapted from the MVP (`TwoD97/Notebook-LoLM/scripts/download-models.mjs`) but trimmed to the tiers we need now. We'll extend with `lite`/`medium`/`pro` LLM tiers + `reranker` in sub-plans 2B/2C.

```js
#!/usr/bin/env node
// Download the GGUFs LokLM uses, by tier. Skips files already on disk.
//
// Usage:
//   node scripts/download-models.mjs              # default: embedder
//   node scripts/download-models.mjs embedder     # BGE-M3 only
//   node scripts/download-models.mjs all          # everything currently known
//
// Re-runs are safe: existing files are skipped. A file matching `skipPattern`
// counts as "already have one" so renames / alt quantisations don't re-download.

import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = resolve(__dirname, '..', 'models')

const MODELS = [
  {
    tier: 'embedder',
    purpose: 'Embedder — BGE-M3 (Q4_K_M)',
    filename: 'bge-m3-Q4_K_M.gguf',
    url: 'https://huggingface.co/lm-kit/bge-m3-gguf/resolve/main/bge-m3-Q4_K_M.gguf',
    sizeGB: 0.75,
    skipPattern: /bge[-_]?m3/i,
  },
]

function alreadyHave(model) {
  if (!existsSync(MODELS_DIR)) return false
  for (const name of readdirSync(MODELS_DIR)) {
    if (name === model.filename) return true
    if (model.skipPattern && model.skipPattern.test(name)) return true
  }
  return false
}

async function download(url, dest) {
  const tmp = dest + '.partial'
  if (existsSync(tmp)) {
    try {
      // eslint-disable-next-line no-undef
      await import('node:fs/promises').then((m) => m.unlink(tmp))
    } catch {
      /* ignore */
    }
  }
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let read = 0
  let lastLog = 0
  const out = createWriteStream(tmp)
  // Node 20+: res.body is a WHATWG ReadableStream; pipe via Web Streams interop.
  const reader = res.body.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out.write(Buffer.from(value))
    read += value.length
    if (total > 0 && Date.now() - lastLog > 1000) {
      const pct = ((read / total) * 100).toFixed(1)
      process.stdout.write(`\r  ${pct}% (${(read / 1024 / 1024).toFixed(0)} / ${(total / 1024 / 1024).toFixed(0)} MB)`)
      lastLog = Date.now()
    }
  }
  out.end()
  await new Promise((r) => out.on('close', r))
  process.stdout.write('\n')
  // atomic rename
  const { rename } = await import('node:fs/promises')
  await rename(tmp, dest)
}

async function main() {
  const arg = (process.argv[2] ?? 'embedder').toLowerCase()
  const wanted = arg === 'all' ? MODELS : MODELS.filter((m) => m.tier === arg || m.filename === arg)
  if (wanted.length === 0) {
    console.error(`Unknown tier "${arg}". Known: ${[...new Set(MODELS.map((m) => m.tier))].join(', ')}, all`)
    process.exit(1)
  }
  if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true })

  for (const m of wanted) {
    if (alreadyHave(m)) {
      console.log(`✓ ${m.filename} — already present, skipping`)
      continue
    }
    const dest = join(MODELS_DIR, m.filename)
    console.log(`↓ ${m.purpose} (${m.sizeGB} GB)`)
    console.log(`  → ${dest}`)
    await download(m.url, dest)
    const finalSize = statSync(dest).size
    console.log(`  ✓ ${(finalSize / 1024 / 1024).toFixed(0)} MB`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

Make it executable: `chmod +x scripts/download-models.mjs` (optional; pnpm runs via node directly).

- [ ] **Step 4: Add pnpm scripts**

Add to `package.json` under `"scripts"`:
```json
"models": "node scripts/download-models.mjs",
"models:embedder": "node scripts/download-models.mjs embedder"
```

- [ ] **Step 5: Run the download to verify**

```bash
pnpm models:embedder
```

Expected: writes `models/bge-m3-Q4_K_M.gguf` (~750 MB). Subsequent runs print "already present, skipping". If the HF URL 404s, swap to any GGUF Q4_K_M variant of BGE-M3 (e.g. `gpustack/bge-m3-GGUF`); update the URL in `MODELS` and re-run.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: NO COMMIT.**

---

## Task 2: HNSW migration

**Files:**
- Create: `src/main/db/migrations/0002_hnsw_index.sql`
- Modify: `src/main/db/migrate.ts`

- [ ] **Step 1: Write `src/main/db/migrations/0002_hnsw_index.sql`**

```sql
-- HNSW index on chunks.embedding for cosine-distance retrieval.
-- pgvector supports HNSW on empty tables, so creating this up-front is safe;
-- index population happens lazily as vectors get written.
-- m and ef_construction defaults follow pgvector's recommended starting point
-- for 1024-dim embeddings on workspaces up to ~100k chunks.
CREATE INDEX IF NOT EXISTS idx_chunks_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

- [ ] **Step 2: Register the new raw migration in `migrate.ts`**

Open `src/main/db/migrate.ts`. Find `RAW_MIGRATIONS`:

```ts
const RAW_MIGRATIONS = ['0001_triggers_funcs.sql']
```

Append the new file:
```ts
const RAW_MIGRATIONS = ['0001_triggers_funcs.sql', '0002_hnsw_index.sql']
```

- [ ] **Step 3: Smoke-verify migrations run cleanly**

```bash
pnpm test --project tx -t schema-objects
```

Expected: all 4 schema-objects tests still pass. The HNSW index is created on the empty `chunks` table during `setupDb()` without error.

- [ ] **Step 4: Add a quick tx test that the index exists**

Append to `tests/tx/db/schema-objects.test.ts` (don't touch the existing four tests):

```ts
  it('idx_chunks_hnsw exists', async () => {
    await withTransaction(async (tx) => {
      const r = await tx.execute(sql`
        SELECT 1 AS ok FROM pg_indexes
         WHERE indexname = 'idx_chunks_hnsw' AND tablename = 'chunks'
      `)
      expect((r.rows as { ok: number }[]).length).toBe(1)
    })
  })
```

Run: `pnpm test --project tx -t schema-objects`. All 5 pass.

- [ ] **Step 5: Typecheck.** `pnpm typecheck` → clean.

- [ ] **Step 6: NO COMMIT.**

---

## Task 3: Port ResourcePlanner verbatim

**Files:**
- Create: `src/main/services/embeddings/ResourcePlanner.ts`

- [ ] **Step 1: Fetch the MVP source**

The full ResourcePlanner is 444 lines. Copy verbatim from `https://github.com/TwoD97/Notebook-LoLM/blob/main/src/main/services/ResourcePlanner.ts`.

Either:
- `gh api repos/TwoD97/Notebook-LoLM/contents/src/main/services/ResourcePlanner.ts --jq '.content' | base64 -d > src/main/services/embeddings/ResourcePlanner.ts`
- Or fetch via curl: `curl -sL https://raw.githubusercontent.com/TwoD97/Notebook-LoLM/main/src/main/services/ResourcePlanner.ts > src/main/services/embeddings/ResourcePlanner.ts`

- [ ] **Step 2: Adapt imports**

The MVP file is self-contained — no LokLM-side imports to fix. Confirm it still compiles by running:

```bash
pnpm typecheck
```

If TS complains about `node-llama-cpp` types not being available in some path, the file dynamic-imports `node-llama-cpp` inside `getLlama()`-style probes; the type-only references should resolve once Task 1's dep install is complete.

- [ ] **Step 3: NO COMMIT.**

---

## Task 4: Extend DocumentsRepo with embedding methods (TDD)

**Files:**
- Modify: `src/main/db/database.ts` — extend `DocumentsRepo`
- Create: `tests/tx/db/embedding-repo.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/tx/db/embedding-repo.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { DocumentsRepo } from '@main/db/database'

const DIM = 1024

function vec(seed: number): number[] {
  // deterministic pseudo-vector; not normalised — pgvector cosine works on any vector
  return Array.from({ length: DIM }, (_, i) => Math.sin((i + 1) * (seed + 1)))
}

describe('DocumentsRepo embedding methods (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('setChunkEmbedding writes a vector and countChunksMissingEmbedding decreases', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'a', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'b', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      expect(await repo.countChunksMissingEmbedding(ws!.id)).toBe(2)
      const written = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (written.rows as { id: number }[]).map((r) => r.id)
      await repo.setChunkEmbedding(ids[0]!, vec(1))
      expect(await repo.countChunksMissingEmbedding(ws!.id)).toBe(1)
    })
  })

  it('listChunksMissingEmbedding returns rows scoped to workspace and paged', async () => {
    await withTransaction(async (tx) => {
      const [wsA] = await tx.insert(workspaces).values({ name: 'a' }).returning()
      const [wsB] = await tx.insert(workspaces).values({ name: 'b' }).returning()
      const [docA] = await tx
        .insert(documents)
        .values({ workspaceId: wsA!.id, title: 'da', sourcePath: '/da' })
        .returning()
      const [docB] = await tx
        .insert(documents)
        .values({ workspaceId: wsB!.id, title: 'db', sourcePath: '/db' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: docA!.id, ordinal: 0, text: 'a0', tokenCount: 1 },
        { documentId: docA!.id, ordinal: 1, text: 'a1', tokenCount: 1 },
        { documentId: docA!.id, ordinal: 2, text: 'a2', tokenCount: 1 },
        { documentId: docB!.id, ordinal: 0, text: 'b0', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const pageA = await repo.listChunksMissingEmbedding(wsA!.id, 2)
      expect(pageA).toHaveLength(2)
      for (const c of pageA) expect(['a0', 'a1', 'a2']).toContain(c.text)
      const pageB = await repo.listChunksMissingEmbedding(wsB!.id, 10)
      expect(pageB).toHaveLength(1)
      expect(pageB[0]!.text).toBe('b0')
    })
  })

  it('ensureVectorIndex is idempotent (no-op when index already exists)', async () => {
    await withTransaction(async (tx) => {
      const repo = new DocumentsRepo(tx as never)
      await repo.ensureVectorIndex()
      await repo.ensureVectorIndex()
      const r = await tx.execute(sql`
        SELECT count(*)::int AS n FROM pg_indexes
         WHERE indexname = 'idx_chunks_hnsw' AND tablename = 'chunks'
      `)
      expect((r.rows as { n: number }[])[0]!.n).toBe(1)
    })
  })

  it('cosine search via SQL returns nearest by embedding', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'A', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'B', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 2, text: 'C', tokenCount: 1 },
      ])
      const rows = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (rows.rows as { id: number }[]).map((r) => r.id)
      const repo = new DocumentsRepo(tx as never)
      await repo.setChunkEmbedding(ids[0]!, vec(1))
      await repo.setChunkEmbedding(ids[1]!, vec(2))
      await repo.setChunkEmbedding(ids[2]!, vec(99))
      // search vector close to vec(2)
      const q = vec(2)
      const r = await tx.execute(sql`
        SELECT id FROM chunks
         ORDER BY embedding <=> ${'[' + q.join(',') + ']'}::vector
         LIMIT 1
      `)
      const top = (r.rows as { id: number }[])[0]!.id
      expect(top).toBe(ids[1])
    })
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test --project tx -t embedding
```

Expected: fails because the methods don't exist on `DocumentsRepo`.

- [ ] **Step 3: Extend `DocumentsRepo` in `src/main/db/database.ts`**

Inside the `DocumentsRepo` class body, append:

```ts
  async countChunksMissingEmbedding(workspaceId: number): Promise<number> {
    const r = await this.db.execute(sql`
      SELECT count(*)::int AS n
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
       WHERE d.workspace_id = ${workspaceId} AND c.embedding IS NULL
    `)
    return (r.rows as { n: number }[])[0]?.n ?? 0
  }

  async listChunksMissingEmbedding(
    workspaceId: number,
    limit: number,
  ): Promise<Array<{ id: number; text: string }>> {
    const r = await this.db.execute(sql`
      SELECT c.id, c.text
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
       WHERE d.workspace_id = ${workspaceId} AND c.embedding IS NULL
       ORDER BY c.id
       LIMIT ${limit}
    `)
    return r.rows as Array<{ id: number; text: string }>
  }

  async setChunkEmbedding(chunkId: number, vector: number[]): Promise<void> {
    // pgvector accepts the bracketed string form; serialise once here.
    const lit = '[' + vector.join(',') + ']'
    await this.db.execute(sql`UPDATE chunks SET embedding = ${lit}::vector WHERE id = ${chunkId}`)
  }

  async ensureVectorIndex(): Promise<void> {
    // HNSW index is created by migration 0002, but this method exists so the
    // backfill service can call it after a model swap repopulates the column.
    // Idempotent via IF NOT EXISTS.
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_chunks_hnsw
        ON chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `)
  }
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm test --project tx -t embedding
```

Expected: all 4 new tests pass. Existing tx tests still green.

- [ ] **Step 5: Typecheck.** `pnpm typecheck` → clean.

- [ ] **Step 6: NO COMMIT.**

---

## Task 5: Port EmbeddingService (retarget arctic → BGE-M3)

**Files:**
- Create: `src/main/services/embeddings/EmbeddingService.ts`

- [ ] **Step 1: Fetch MVP source**

```bash
curl -sL https://raw.githubusercontent.com/TwoD97/Notebook-LoLM/main/src/main/services/EmbeddingService.ts > src/main/services/embeddings/EmbeddingService.ts
```

- [ ] **Step 2: Apply BGE-M3 adaptations**

Open `src/main/services/embeddings/EmbeddingService.ts` and change exactly these constants/values:

```ts
// Was: 'arctic-embed-l-v2.0-Q8_0.gguf'
export const BUNDLED_EMBEDDER_FILE = 'bge-m3-Q4_K_M.gguf'

// Was: 'query: '
const QUERY_PREFIX = ''

// PASSAGE_PREFIX stays ''
// EMBEDDING_DIM stays 1024
// EMBED_CONTEXT_SIZE stays 2048
// SANITIZE_MAX_CHARS stays 6000
```

Fix the import path for `ResourcePlanner` (it now lives next door in the same folder, so `./ResourcePlanner` stays correct).

Update the error message in `ensureReady` that hardcodes the old filename — search for `arctic-embed` in the file and replace any remaining text references with `bge-m3` or the BUNDLED_EMBEDDER_FILE constant.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. The MVP file uses `import('node-llama-cpp')` dynamically so types resolve at call-site.

- [ ] **Step 4: Manual sanity check (optional but valuable)**

Only attempt if you can spare ~30 seconds of GPU/CPU time:
```bash
node -e "
import('./src/main/services/embeddings/EmbeddingService.ts').catch(() => {})
// the ts-loader path isn't trivial under plain node; skip this step if it errors.
"
```

If skipped, that's fine — Task 8's integration test exercises the real load path.

- [ ] **Step 5: NO COMMIT.**

---

## Task 6: Port EmbeddingBackfillService

**Files:**
- Create: `src/main/services/embeddings/EmbeddingBackfillService.ts`

- [ ] **Step 1: Fetch MVP source**

```bash
curl -sL https://raw.githubusercontent.com/TwoD97/Notebook-LoLM/main/src/main/services/EmbeddingBackfillService.ts > src/main/services/embeddings/EmbeddingBackfillService.ts
```

- [ ] **Step 2: Fix the Database import path**

The MVP file imports `import type { Database } from '../db/database'`. From the new location `src/main/services/embeddings/`, that becomes `'../../db/database'`. Edit:

```ts
// before
import type { Database } from '../db/database'
import type { EmbeddingService } from './EmbeddingService'

// after
import type { Database } from '../../db/database'
import type { EmbeddingService } from './EmbeddingService'
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. The methods `countChunksMissingEmbedding`, `listChunksMissingEmbedding`, `setChunkEmbedding`, `ensureVectorIndex` are now on `DocumentsRepo` but the MVP code calls them on `Database` directly. Bridge by either:
  (a) Forwarding from `Database` instance methods (one-liners), or
  (b) Changing the MVP file to use `db.documents().countChunksMissingEmbedding(...)` etc.

Prefer (b) — keeps `Database` lean. Edit the four call sites in `EmbeddingBackfillService.ts`:

```ts
// before
const total = await this.db.countChunksMissingEmbedding(workspaceId)
// after
const total = await this.db.documents().countChunksMissingEmbedding(workspaceId)
```

Apply to all four method calls (`countChunksMissingEmbedding`, `listChunksMissingEmbedding`, `setChunkEmbedding`, `ensureVectorIndex`).

Re-run `pnpm typecheck` until clean.

- [ ] **Step 4: NO COMMIT.**

---

## Task 7: Wire embedding phase in DocumentService

**Files:**
- Modify: `src/main/services/documents/DocumentService.ts`

- [ ] **Step 1: Accept an embedder in the constructor**

Open `src/main/services/documents/DocumentService.ts`. Update the constructor and class body:

```ts
import type { EmbeddingService } from '../embeddings/EmbeddingService'

// ...

export class DocumentService {
  constructor(
    private readonly auth: AuthService,
    private readonly embedder?: EmbeddingService,
  ) {}
```

The embedder is **optional** so existing callers (and tests that don't care about vectors) still work — when undefined, the embedding phase stays a no-op exactly as Spec 1 left it.

- [ ] **Step 2: Implement the embedding phase**

Find `indexInBackground()`. Locate the existing `send('embedding', 3)` line. Replace the body between that and `send('persisting', 4)` with:

```ts
      send('embedding', 3)
      let vectors: Array<number[] | null> | null = null
      if (this.embedder && (await this.embedder.ensureReady())) {
        vectors = await this.embedder.embedPassages(out.map((c) => c.text))
      }

      send('persisting', 4)
      await repo.persistChunks(
        doc.id,
        out.map((c) => ({
          ordinal: c.ordinal,
          text: c.text,
          pageFrom: c.pageFrom,
          pageTo: c.pageTo,
          tokenCount: estimateTokens(c.text),
        })),
      )
      if (vectors) {
        // chunks were just inserted; fetch their ids by document_id + ordinal
        // and write embeddings. Cheap because we know exactly how many were
        // inserted and the ordinals are sequential.
        const allChunks = await repo['db'].execute(sql`
          SELECT id, ordinal FROM chunks WHERE document_id = ${doc.id} ORDER BY ordinal
        `)
        type Row = { id: number; ordinal: number }
        const rows = allChunks.rows as Row[]
        const byOrdinal = new Map<number, number>(rows.map((r) => [r.ordinal, r.id]))
        for (let i = 0; i < out.length; i++) {
          const v = vectors[i]
          const id = byOrdinal.get(out[i].ordinal)
          if (v && id != null) {
            await repo.setChunkEmbedding(id, v)
          }
        }
      }
```

You'll need to add `import { sql } from 'drizzle-orm'` at the top if it's not already there.

Note: the `repo['db']` access is a deliberate escape hatch — `DocumentsRepo` doesn't currently expose its handle publicly. Alternative: add a `executeRaw<T>(query)` method to `DocumentsRepo`. Pick whichever is less intrusive; both compile.

- [ ] **Step 3: Update the existing integration test to remain green**

The existing `tests/integration/document-import.test.ts` constructs `new DocumentService(auth)` without an embedder. That still works (embedder optional → no-op embedding phase). Re-run:

```bash
pnpm test --project integration -t document-import
```

Expected: all 3 existing tests still pass.

- [ ] **Step 4: Typecheck.** `pnpm typecheck` → clean.

- [ ] **Step 5: NO COMMIT.**

---

## Task 8: Integration test — backfill end-to-end

**Files:**
- Create: `tests/integration/embedding-backfill.test.ts`

This is the most rigorous test in the plan and is the proof that Plan 2A actually works. It loads the real BGE-M3 embedder.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import type { IndexProgress } from '@main/services/documents/types'

const MODEL_PATH = join(process.cwd(), 'models', 'bge-m3-Q4_K_M.gguf')

describe.runIf(existsSync(MODEL_PATH))('embedding backfill (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-embed-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('imports without embedder → backfill fills NULL embeddings', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const filePath = join(dir, 'sample.md')
    await writeFile(filePath, '# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n\nDrittes auf deutsch.', 'utf-8')

    // First import: no embedder → vectors stay NULL
    const sent: IndexProgress[] = []
    const docsNoEmbed = new DocumentService(auth)
    const doc = await docsNoEmbed.importFile({
      workspaceId: ws.id,
      sourcePath: filePath,
      sender: { send: (_c: string, p: IndexProgress) => sent.push(p) } as unknown as Electron.WebContents,
    })
    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 10_000)

    const db = auth.requireDatabase()
    const missing = await db.documents().countChunksMissingEmbedding(ws.id)
    expect(missing).toBeGreaterThan(0)

    // Now warm the embedder + run backfill
    const embedder = new EmbeddingService()
    const ok = await embedder.ensureReady()
    expect(ok).toBe(true)
    const backfill = new EmbeddingBackfillService(db, embedder)
    await backfill.run(ws.id)

    const missingAfter = await db.documents().countChunksMissingEmbedding(ws.id)
    expect(missingAfter).toBe(0)
    void doc
  }, 180_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
```

`describe.runIf(...)` skips the suite when the model file is absent — important so CI without bundled GGUFs still passes. Locally with `pnpm models:embedder` already done, the test runs.

- [ ] **Step 2: Run the test**

```bash
pnpm test --project integration -t embedding
```

Expected on a dev machine with `models/bge-m3-Q4_K_M.gguf` present: passes within ~30–120 s depending on hardware. On CI / machines without the model file: skipped.

Possible issues + fixes:
- "Cannot load native binding for node-llama-cpp on linux-x64": confirms Task 1's prebuild isn't on this platform. Run `pnpm rebuild node-llama-cpp` against the project's electron version using `@electron/rebuild`. For raw node tests (vitest), `pnpm rebuild node-llama-cpp` alone is fine.
- "Embedder returned no usable vectors": dimension mismatch. Confirm the column is `vector(1024)` and BGE-M3 emits 1024-dim. The `EMBEDDING_DIM` constant must match.
- "out of memory": switch CPU placement via `embedder.setPlacement('cpu')` before `ensureReady()`.

- [ ] **Step 3: NO COMMIT.**

---

## Task 9: IPC handlers (main + preload)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/documents.ts`
- Modify: `src/renderer/src/setupTests.ts`

- [ ] **Step 1: Add types to `src/shared/documents.ts`**

Append:
```ts
export type EmbedderState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface EmbedderStatus {
  kind: 'embedder'
  state: EmbedderState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
}

export interface EmbedderInfo extends EmbedderStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementChoice: 'auto' | 'cpu' | 'gpu'
  placementReason: string | null
}

export interface BackfillStatus {
  workspaceId: number
  state: 'idle' | 'running' | 'done' | 'failed'
  done: number
  total: number
  message: string | null
}
```

- [ ] **Step 2: Wire singletons in `src/main/index.ts`**

Open the file. After the existing `getDocumentService()`, add:

```ts
import { EmbeddingService } from './services/embeddings/EmbeddingService'
import { EmbeddingBackfillService } from './services/embeddings/EmbeddingBackfillService'

let embeddingService: EmbeddingService | null = null
let backfillService: EmbeddingBackfillService | null = null

function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService()
    // push status events to all renderer windows whenever the embedder state changes
    embeddingService.subscribe((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('embedder:status', status)
        } catch {
          /* ignore */
        }
      }
    })
  }
  return embeddingService
}

function getBackfillService(): EmbeddingBackfillService {
  if (!backfillService) {
    backfillService = new EmbeddingBackfillService(getAuth().requireDatabase(), getEmbeddingService())
  }
  return backfillService
}
```

Note: `getBackfillService()` calls `requireDatabase()`, which throws when locked. Resolve by deferring construction — the IPC handlers below call it lazily, and the renderer only triggers backfill after login.

Also wire the embedder into the DocumentService:
```ts
function getDocumentService(): DocumentService {
  documentService ??= new DocumentService(getAuth(), getEmbeddingService())
  return documentService
}
```

- [ ] **Step 3: Register IPC handlers**

Inside `registerIpc()`, after the documents handlers, append:

```ts
  // embedder
  ipcMain.handle('embedder:status', async () => getEmbeddingService().getStatus())
  ipcMain.handle('embedder:info', async () => getEmbeddingService().info())
  ipcMain.handle('embedder:reload', async () => {
    await getEmbeddingService().unload()
    await getEmbeddingService().ensureReady()
    return getEmbeddingService().info()
  })
  ipcMain.handle('embedder:setPlacement', async (_e, choice: 'auto' | 'cpu' | 'gpu') => {
    getEmbeddingService().setPlacement(choice)
  })

  // backfill
  ipcMain.handle('embedder:backfillStatus', async (_e, workspaceId: number) =>
    getBackfillService().status(workspaceId),
  )
  ipcMain.handle('embedder:runBackfill', async (_e, workspaceId: number) => {
    await getBackfillService().run(workspaceId)
  })
```

- [ ] **Step 4: Extend the preload bridge**

In `src/preload/index.ts`, add the import:
```ts
import type { EmbedderStatus, EmbedderInfo, BackfillStatus } from '../shared/documents'
```

In the `api` object, after `documents:`, add:
```ts
  embedder: {
    status: (): Promise<EmbedderStatus> => ipcRenderer.invoke('embedder:status'),
    info: (): Promise<EmbedderInfo> => ipcRenderer.invoke('embedder:info'),
    reload: (): Promise<EmbedderInfo> => ipcRenderer.invoke('embedder:reload'),
    setPlacement: (choice: 'auto' | 'cpu' | 'gpu'): Promise<void> =>
      ipcRenderer.invoke('embedder:setPlacement', choice),
    backfillStatus: (workspaceId: number): Promise<BackfillStatus> =>
      ipcRenderer.invoke('embedder:backfillStatus', workspaceId),
    runBackfill: (workspaceId: number): Promise<void> =>
      ipcRenderer.invoke('embedder:runBackfill', workspaceId),
    onStatus: (cb: (s: EmbedderStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: EmbedderStatus): void => cb(s)
      ipcRenderer.on('embedder:status', listener)
      return () => {
        ipcRenderer.removeListener('embedder:status', listener)
      }
    },
    onBackfillStatus: (cb: (s: BackfillStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: BackfillStatus): void => cb(s)
      ipcRenderer.on('embedder:backfillStatus', listener)
      return () => {
        ipcRenderer.removeListener('embedder:backfillStatus', listener)
      }
    },
  },
```

- [ ] **Step 5: Stub the new API in `src/renderer/src/setupTests.ts`**

Inside the `stub: Api = { ... }` object, add:

```ts
  embedder: {
    status: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
      }),
    info: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    reload: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    setPlacement: () => Promise.resolve(),
    backfillStatus: (workspaceId: number) =>
      Promise.resolve({ workspaceId, state: 'idle' as const, done: 0, total: 0, message: null }),
    runBackfill: () => Promise.resolve(),
    onStatus: () => () => undefined,
    onBackfillStatus: () => () => undefined,
  },
```

- [ ] **Step 6: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Both must exit 0. The setupTests stub is the most likely typecheck snag — fix by tightening literal `'as const'` annotations on the enum-like fields.

- [ ] **Step 7: NO COMMIT.**

---

## Task 10: Trigger backfill after unlock

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: After successful login or register, fire-and-forget backfill for every workspace**

In `src/main/index.ts`, find the `'auth:login'` IPC handler. After `broadcastAuthState()`, add:

```ts
  if (result.ok) {
    void scheduleBackfillForAllWorkspaces().catch(() => {
      /* swallow — embedder may not be available; status events surface failures */
    })
  }
```

Add the same after `'auth:register'` success.

Then add the helper:
```ts
async function scheduleBackfillForAllWorkspaces(): Promise<void> {
  // best-effort: if the embedder isn't ready (no model file), the backfill
  // service silently records 'failed' for each workspace and the user can
  // retry from Settings later.
  const wss = await getAuth().requireDatabase().workspaces().list()
  for (const ws of wss) {
    void getBackfillService().run(ws.id)
  }
}
```

- [ ] **Step 2: Typecheck.** Clean.

- [ ] **Step 3: NO COMMIT.**

---

## Task 11: Final verification

- [ ] **Step 1: Full test sweep**

```bash
pnpm test
```

Expected:
- `unit`: 16 pass (parser + chunker from Spec 1)
- `tx`: 14 pass (4 schema-objects + 1 new HNSW + 4 new embedding-repo + 4 schema-objects from Spec 1 + 1 example × 2) — count adjusts as you add; the pre-existing vault failure stays
- `integration`: 8 pass (3 docs + 2 ws + 2 auth + 1 backfill-if-model-present, else skipped)
- `web`: 2 pass (App smoke)
- `node`: 3 pass (authHelpers smoke)

The only allowed failure is the pre-existing `vault round-trip > reset mit passphrase` test from Spec 1's baseline.

- [ ] **Step 2: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Both green.

- [ ] **Step 3: Optional manual smoke**

If you have the model file present:
1. `pnpm dev`
2. Register + login.
3. Import a `.md` file.
4. Open devtools, run `await window.api.embedder.status()` — expect `state: 'ready'` after a few seconds.
5. Run `await window.api.embedder.backfillStatus(1)` — expect `state: 'done', done > 0`.

- [ ] **Step 4: NO COMMIT. Hand back to the controller for the milestone commit.**

---

## Self-Review

### Spec coverage (Plan 2A scope only — AP-4.3)

| Spec section | Task | Notes |
|---|---|---|
| BGE-M3 GGUF bundled via extraResources / downloaded | 1 | `pnpm models:embedder` resolves "missing models" |
| `EmbeddingService` with lazy load + CPU/GPU adaptive | 3, 5 | Verbatim port + 3 BGE-M3 retargets |
| `chunks.embedding` filled at import | 7 | Embedding phase wired in `DocumentService.indexInBackground` |
| `EmbeddingBackfillService.run()` on launch + login | 6, 10 | Per-workspace, fire-and-forget, status push via IPC |
| HNSW index `idx_chunks_hnsw` cosine, m=16, ef_construction=64 | 2 | Lazy create OK (pgvector accepts empty-table HNSW) |
| Tests: tx for vector search, integration for backfill | 4, 8 | `embedding-repo.test.ts` + `embedding-backfill.test.ts` |
| Snapshot bloat acceptance (~24 MB at eval-set size) | n/a | Inherent; no code change. Documented in spec. |

### Out of scope for 2A (lands in 2B / 2C)

- BM25 query-side SQL (AP-4.2) — Plan 2B
- RRF fusion + reranker + heuristics (AP-4.4) — Plan 2B
- LlamaService + prompt assembly (AP-7.2) — Plan 2C
- QAService.answer + streaming IPC (AP-7.2) — Plan 2C
- Refusal threshold (AP-7.4) — Plan 2C
- Chat UI (AP-7.1) — separate, not in Spec 2

### Placeholder scan

- All "TBD" or "implement later" markers absent.
- Two escape hatches documented honestly:
  - HF URL for BGE-M3 in Task 1 — instructions for swapping if it 404s.
  - `repo['db']` access in Task 7 — alternative `executeRaw` method noted.
- Task 8's test is gated by `describe.runIf(existsSync(MODEL_PATH))` so CI without the model file still passes.

### Type consistency

- `EmbedderStatus` and `BackfillStatus` shapes match the MVP and are mirrored into `src/shared/documents.ts` for renderer use.
- `DocumentsRepo` gains four methods called from both `EmbeddingBackfillService` and (via `repo['db']`) `DocumentService`.
- `EmbeddingService.embedPassages` returns `Array<number[] | null>` — Task 7 and Task 6 both treat null entries as skip.

### Risks / known-unknowns

- **BGE-M3 GGUF URL stability.** HF hosts move; the URL in Task 1 may 404 — implementer reports a swap if needed.
- **node-llama-cpp prebuild compatibility.** Native binding for the user's OS/arch must exist; falling back to `pnpm rebuild` is a documented step in Task 8 failure paths.
- **pgvector cosine operator string formatting.** The plan uses `'[' + v.join(',') + ']'` literals — works in pglite but worth confirming via Task 4 tests before relying in production.
- **First-login backfill on a fresh install.** If the user logs in before `pnpm models:embedder` ran, every workspace's backfill records 'failed'. UI should communicate this; Spec 2 settings UI (AP-9) lands later. For now the IPC `embedder:status` channel exposes enough state for a future Settings panel.

---

## End of plan
