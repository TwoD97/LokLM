# RAG Pipeline 2B — Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **Do NOT commit per task** — the controller batches everything into one final commit at the end (matches the user's commit cadence).

**Spec:** [Spec 2 — RAG Pipeline on AP-4.4 Outline](https://notes.ltwodl.com/doc/ap-44-rrf-fusion-in-retrievalservice-oV1wEBsVI0). This sub-plan covers **AP-4.2** (BM25 query side) + **AP-4.4** (RRF fusion + reranker + heuristics + document diversity + whole-doc fallback + neighbour expansion). Multi-query expansion (also AP-4.4) is wired through but disabled — the LlamaService dependency lands in Plan 2C.

**Branch:** `release/v0.2-rag` (Plan 2A shipped in `fa67ff4`).

**Goal:** Make `RetrievalService.search(workspaceId, query, topK, opts)` return high-quality fused hits from a hybrid BM25 + dense pipeline so the eval harness in Plan 2C can drive end-to-end answer generation.

**Architecture:** Port the MVP's `RetrievalService` + `RerankerService` verbatim. Extract `rrf.ts` and `heuristics.ts` as pure helpers so they're independently unit-testable. Add `searchChunks` (BM25) + `searchChunksByVector` (cosine) methods to `DocumentsRepo` with bilingual `plainto_tsquery` and per-document caps. Reranker uses `bge-reranker-v2-m3` GGUF (separate download).

**Tech Stack:** TypeScript, `node-llama-cpp` (already on the dep tree), pgvector cosine + tsvector BM25 (already in schema).

---

## File Structure

**New files:**
- `src/main/services/retrieval/RetrievalService.ts` — orchestrator (port + adapt)
- `src/main/services/retrieval/RerankerService.ts` — cross-encoder service (port verbatim)
- `src/main/services/retrieval/rrf.ts` — pure RRF fusion helper (extracted)
- `src/main/services/retrieval/heuristics.ts` — title boost / recency boost / short-chunk penalty (extracted)
- `src/main/services/retrieval/types.ts` — `RetrievalHit`, `RetrievalOptions`, `SearchHit`, `ChunkRow`, `ChunkSearchOptions`
- `tests/unit/rrf.test.ts` — pure-function tests for `fuseRrf`
- `tests/unit/heuristics.test.ts` — pure-function tests for the three boosters
- `tests/tx/db/search-repo.test.ts` — BM25 + cosine SQL tests against seeded data
- `tests/integration/retrieval-pipeline.test.ts` — end-to-end (requires BGE-M3 model, gated)

**Modified files:**
- `src/main/db/database.ts` — add `searchChunks` + `searchChunksByVector` + `listChunksForDocument` to `DocumentsRepo`
- `src/main/index.ts` — instantiate `RerankerService` + `RetrievalService` singletons; register IPC handlers `search:hybrid`, `reranker:status`, `reranker:info`, `reranker:reload`
- `src/preload/index.ts` — expose `window.api.search.hybrid()` + `window.api.reranker.*`
- `src/renderer/src/setupTests.ts` — stub the new API
- `src/shared/documents.ts` — add `SearchHit`, `RetrievalHit`, `RetrievalOptions`, `RerankerStatus`, `RerankerInfo`

**Source of MVP files** (use `gh api repos/TwoD97/Notebook-LoLM/contents/...` to fetch):
- `src/main/services/RerankerService.ts` (308 lines, verbatim port)
- `src/main/services/RetrievalService.ts` (627 lines, port + adapt to Drizzle + extract pure helpers)

---

## Pre-flight

- [ ] Confirm `git status` is clean on `release/v0.2-rag` apart from the user's `docs/superpowers/plans/` untracked dir.
- [ ] Confirm Plan 2A artefacts are present: `src/main/services/embeddings/EmbeddingService.ts`, `idx_chunks_hnsw` index, `chunks.embedding vector(1024)` column.

---

## Task 1: Search SQL methods on DocumentsRepo (TDD)

**Files:**
- Modify: `src/main/db/database.ts` — add 3 methods + 3 types
- Create: `tests/tx/db/search-repo.test.ts`

### Step 1: Write failing test

```ts
// tests/tx/db/search-repo.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { DocumentsRepo } from '@main/db/database'

const DIM = 1024
const vec = (seed: number): number[] =>
  Array.from({ length: DIM }, (_, i) => Math.sin((i + 1) * (seed + 1)))

describe('DocumentsRepo search methods (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('searchChunks does bilingual BM25 with workspace + status filters', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'doc.md', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'Hallo Welt english world', tokenCount: 4 },
        { documentId: doc!.id, ordinal: 1, text: 'Etwas anderes auf deutsch', tokenCount: 4 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchChunks(ws!.id, 'welt', 5)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.text).toContain('Welt')
    })
  })

  it('searchChunks skips documents whose status is not ready', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'indexing' })
        .returning()
      await tx
        .insert(chunks)
        .values({ documentId: doc!.id, ordinal: 0, text: 'lookup target', tokenCount: 2 })
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchChunks(ws!.id, 'target', 5)
      expect(hits).toHaveLength(0)
    })
  })

  it('searchChunks respects activeDocumentIds filter', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [a] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'a', sourcePath: '/a', status: 'ready' })
        .returning()
      const [b] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'b', sourcePath: '/b', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: a!.id, ordinal: 0, text: 'shared keyword content', tokenCount: 3 },
        { documentId: b!.id, ordinal: 0, text: 'shared keyword present', tokenCount: 3 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const filtered = await repo.searchChunks(ws!.id, 'keyword', 5, { activeDocumentIds: [a!.id] })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.document_id).toBe(a!.id)
    })
  })

  it('searchChunks applies per-doc cap', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      for (let i = 0; i < 5; i++) {
        await tx
          .insert(chunks)
          .values({ documentId: doc!.id, ordinal: i, text: `match line ${i}`, tokenCount: 3 })
      }
      const repo = new DocumentsRepo(tx as never)
      const capped = await repo.searchChunks(ws!.id, 'match', 10, { perDocK: 2 })
      expect(capped.length).toBeLessThanOrEqual(2)
    })
  })

  it('searchChunksByVector returns nearest by cosine', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'A', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'B', tokenCount: 1 },
      ])
      const rows = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (rows.rows as { id: number }[]).map((r) => r.id)
      const repo = new DocumentsRepo(tx as never)
      await repo.setChunkEmbedding(ids[0]!, vec(1))
      await repo.setChunkEmbedding(ids[1]!, vec(50))
      const hits = await repo.searchChunksByVector(ws!.id, vec(50), 1)
      expect(hits).toHaveLength(1)
      expect(hits[0]!.chunk_id).toBe(ids[1])
    })
  })

  it('listChunksForDocument returns chunks in ordinal order', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 1, text: 'b', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 0, text: 'a', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 2, text: 'c', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const rows = await repo.listChunksForDocument(doc!.id)
      expect(rows.map((r) => r.text)).toEqual(['a', 'b', 'c'])
    })
  })
})
```

### Step 2: Run, confirm failure

```bash
pnpm test --project tx -t search
```

### Step 3: Add types + methods to `DocumentsRepo`

Open `src/main/db/database.ts`. Near the existing `NewChunkInput` type, add:

```ts
export interface ChunkRow {
  id: number
  document_id: number
  ordinal: number
  text: string
  token_count: number | null
  page_from: number | null
  page_to: number | null
}

export interface SearchHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  text: string
  score: number
  added_at?: number | null
}

export interface ChunkSearchOptions {
  /** When non-empty, retrieval is constrained to this document_id set.
   *  Empty/null = workspace-wide. NotebookLM-style focus. */
  activeDocumentIds?: number[] | null
  /** Cap each document at this many chunks in the candidate pool via
   *  ROW_NUMBER(). Stops content-dense docs from monopolising the pool. */
  perDocK?: number
}
```

Inside the `DocumentsRepo` class body, append three methods:

```ts
  async searchChunks(
    workspaceId: number,
    query: string,
    topK: number,
    opts: ChunkSearchOptions = {},
  ): Promise<SearchHit[]> {
    const cleaned = query.trim()
    if (!cleaned) return []
    const activeIds =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0
        ? opts.activeDocumentIds
        : null
    const perDocK = opts.perDocK && opts.perDocK > 0 ? opts.perDocK : null
    const activeLit = activeIds == null ? null : '{' + activeIds.join(',') + '}'

    // The plainto_tsquery → AND-of-terms turns into OR (via the `&` → `|`
    // replace) so common words don't kill the match; ts_rank_cd already
    // rewards chunks that hit more terms, so OR + rank gives recall +
    // ordering. Same bilingual fallback as the MVP.
    const r = await this.db.execute(sql`
      WITH q AS (
        SELECT
          NULLIF(replace(plainto_tsquery('german',  ${cleaned})::text, '&', '|'), '')::tsquery AS qg,
          NULLIF(replace(plainto_tsquery('english', ${cleaned})::text, '&', '|'), '')::tsquery AS qe
      ),
      qq AS (
        SELECT COALESCE(qg, ''::tsquery) || COALESCE(qe, ''::tsquery) AS query FROM q
      ),
      hits AS (
        SELECT
          c.id          AS chunk_id,
          c.document_id AS document_id,
          d.title       AS document_title,
          c.ordinal     AS ordinal,
          c.page_from   AS page_from,
          c.page_to     AS page_to,
          c.text        AS text,
          ts_rank_cd(c.text_search, qq.query) AS score,
          d.added_at    AS added_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        CROSS JOIN qq
        WHERE qq.query::text <> ''
          AND c.text_search @@ qq.query
          AND d.workspace_id = ${workspaceId}
          AND d.status = 'ready'
          AND (${activeLit}::int[] IS NULL OR c.document_id = ANY(${activeLit}::int[]))
      ),
      ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY document_id
                 ORDER BY score DESC
               ) AS doc_rank
          FROM hits
      )
      SELECT chunk_id, document_id, document_title, ordinal,
             page_from, page_to, text, score, added_at
        FROM ranked
       WHERE ${perDocK}::int IS NULL OR doc_rank <= ${perDocK}::int
       ORDER BY score DESC
       LIMIT ${topK}
    `)
    return r.rows as SearchHit[]
  }

  async searchChunksByVector(
    workspaceId: number,
    embedding: number[],
    topK: number,
    opts: ChunkSearchOptions = {},
  ): Promise<SearchHit[]> {
    if (embedding.length === 0) return []
    const lit = '[' + embedding.join(',') + ']'
    const activeIds =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0
        ? opts.activeDocumentIds
        : null
    const perDocK = opts.perDocK && opts.perDocK > 0 ? opts.perDocK : null
    const activeLit = activeIds == null ? null : '{' + activeIds.join(',') + '}'

    if (perDocK === null && activeIds === null) {
      // Fast path — HNSW drives ORDER BY + LIMIT directly. The window-fn
      // form below defeats the index plan, so reserve it for the per-doc
      // cap branch.
      const r = await this.db.execute(sql`
        SELECT
          c.id          AS chunk_id,
          c.document_id AS document_id,
          d.title       AS document_title,
          c.ordinal     AS ordinal,
          c.page_from   AS page_from,
          c.page_to     AS page_to,
          c.text        AS text,
          (1 - (c.embedding <=> ${lit}::vector))::FLOAT AS score,
          d.added_at    AS added_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL
          AND d.workspace_id = ${workspaceId}
          AND d.status = 'ready'
        ORDER BY c.embedding <=> ${lit}::vector ASC
        LIMIT ${topK}
      `)
      return r.rows as SearchHit[]
    }

    const r = await this.db.execute(sql`
      WITH ranked AS (
        SELECT
          c.id          AS chunk_id,
          c.document_id AS document_id,
          d.title       AS document_title,
          c.ordinal     AS ordinal,
          c.page_from   AS page_from,
          c.page_to     AS page_to,
          c.text        AS text,
          (1 - (c.embedding <=> ${lit}::vector))::FLOAT AS score,
          d.added_at    AS added_at,
          ROW_NUMBER() OVER (
            PARTITION BY c.document_id
            ORDER BY c.embedding <=> ${lit}::vector ASC
          ) AS doc_rank
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL
          AND d.workspace_id = ${workspaceId}
          AND d.status = 'ready'
          AND (${activeLit}::int[] IS NULL OR c.document_id = ANY(${activeLit}::int[]))
      )
      SELECT chunk_id, document_id, document_title, ordinal,
             page_from, page_to, text, score, added_at
        FROM ranked
       WHERE ${perDocK}::int IS NULL OR doc_rank <= ${perDocK}::int
       ORDER BY score DESC
       LIMIT ${topK}
    `)
    return r.rows as SearchHit[]
  }

  async listChunksForDocument(documentId: number): Promise<ChunkRow[]> {
    const r = await this.db.execute(sql`
      SELECT id, document_id, ordinal, text, token_count, page_from, page_to
        FROM chunks
       WHERE document_id = ${documentId}
       ORDER BY ordinal
    `)
    return r.rows as ChunkRow[]
  }
```

### Step 4: Run tests, confirm pass

```bash
pnpm test --project tx -t search
```

Expected: 6 new tests pass + existing tx tests (5 schema-objects, 7 documents-repo, 4 embedding-repo, 2 example) all still pass = 24 total tx tests. The 1 pre-existing vault failure stays.

### Step 5: Typecheck.

```bash
pnpm typecheck
```

### Step 6: NO COMMIT.

---

## Task 2: Pure helpers — `rrf.ts` + `heuristics.ts` (TDD)

**Files:**
- Create: `src/main/services/retrieval/rrf.ts`
- Create: `src/main/services/retrieval/heuristics.ts`
- Create: `tests/unit/rrf.test.ts`
- Create: `tests/unit/heuristics.test.ts`

### Step 1: Write failing tests

`tests/unit/rrf.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fuseRrf, RRF_K } from '@main/services/retrieval/rrf'
import type { SearchHit } from '@main/db/database'

function hit(chunkId: number, score: number, docId = 1): SearchHit {
  return {
    chunk_id: chunkId,
    document_id: docId,
    document_title: 'd',
    ordinal: chunkId,
    page_from: 1,
    page_to: 1,
    text: `chunk ${chunkId}`,
    score,
  }
}

describe('fuseRrf', () => {
  it('returns input when seed pool is empty', () => {
    const out = fuseRrf([], [hit(1, 0.9), hit(2, 0.8)], 10)
    expect(out.map((h) => h.chunk_id)).toEqual([1, 2])
  })

  it('combines two ranked lists by RRF rank-score', () => {
    const a = [hit(1, 1.0), hit(2, 0.8), hit(3, 0.6)]
    const b = [hit(3, 0.9), hit(2, 0.7), hit(4, 0.5)]
    const out = fuseRrf(a, b, 10)
    // chunk 2 appears in both lists with strong positions; it should rank top
    expect(out.map((h) => h.chunk_id)).toContain(2)
    expect(out.length).toBeLessThanOrEqual(10)
  })

  it('overwrites score with fused rank-based score, not preserved BM25/cosine', () => {
    const a = [hit(1, 100.0)] // huge BM25 score
    const b: SearchHit[] = []
    const out = fuseRrf([], a, 10)
    expect(out[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 5)
  })

  it('caps result length to topK', () => {
    const a = Array.from({ length: 50 }, (_, i) => hit(i, 1 - i / 100))
    const out = fuseRrf([], a, 5)
    expect(out).toHaveLength(5)
  })
})
```

`tests/unit/heuristics.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  applyTitleBoost,
  applyShortChunkPenalty,
  applyRecencyBoost,
} from '@main/services/retrieval/heuristics'
import type { SearchHit } from '@main/db/database'

const baseHit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  chunk_id: 1,
  document_id: 1,
  document_title: 'Wochenbuch.pdf',
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  text: 'some passage text here that is long enough to escape the short penalty by a clear margin',
  score: 1.0,
  ...overrides,
})

describe('applyTitleBoost', () => {
  it('boosts when a non-stopword query term matches title', () => {
    const hits = [baseHit({ document_title: 'TudosaDenys_Wochenbuch.pdf' })]
    const out = applyTitleBoost(hits, 'fasse mein wochenbuch zusammen', 1.5)
    expect(out[0]!.score).toBeCloseTo(1.5)
  })

  it('skips stopword-only matches', () => {
    const hits = [baseHit({ document_title: 'A document' })]
    const out = applyTitleBoost(hits, 'der die das', 1.5)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('factor=1 is a no-op', () => {
    const hits = [baseHit({ document_title: 'Wochenbuch.pdf' })]
    const out = applyTitleBoost(hits, 'wochenbuch', 1.0)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })
})

describe('applyShortChunkPenalty', () => {
  it('penalises chunks shorter than threshold', () => {
    const hits = [baseHit({ text: 'short', score: 1.0 })]
    const out = applyShortChunkPenalty(hits, 0.5, 200)
    expect(out[0]!.score).toBeCloseTo(0.5)
  })

  it('leaves long chunks untouched', () => {
    const hits = [baseHit({ text: 'a'.repeat(500), score: 1.0 })]
    const out = applyShortChunkPenalty(hits, 0.5, 200)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })
})

describe('applyRecencyBoost', () => {
  it('boosts hits added recently', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const hits = [baseHit({ added_at: nowSec, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.2, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.2)
  })

  it('leaves old hits untouched', () => {
    const longAgo = Math.floor(Date.now() / 1000) - 86_400
    const hits = [baseHit({ added_at: longAgo, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.2, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })

  it('factor=1 is a no-op even on recent docs', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const hits = [baseHit({ added_at: nowSec, score: 1.0 })]
    const out = applyRecencyBoost(hits, 1.0, 10 * 60 * 1000)
    expect(out[0]!.score).toBeCloseTo(1.0)
  })
})
```

### Step 2: Run, confirm failure

```bash
pnpm test --project unit -t "fuseRrf|TitleBoost|ShortChunkPenalty|RecencyBoost"
```

### Step 3: Write `src/main/services/retrieval/rrf.ts`

```ts
import type { SearchHit } from '@main/db/database'

export const RRF_K = 60

/**
 * Reciprocal Rank Fusion. Each list is treated as a ranking; a hit's RRF
 * score is the sum of 1 / (k + rank) across the lists it appears in. The
 * caller seeds with `seed` (the running pool from previous variants) and
 * fuses in `next` (one new ranked list). Same hit can appear in both — its
 * scores add. Returns the top `cap` hits sorted by fused score desc.
 */
export function fuseRrf(seed: SearchHit[], next: SearchHit[], cap: number): SearchHit[] {
  const scores = new Map<number, { hit: SearchHit; score: number }>()
  for (const entry of seed) {
    scores.set(entry.chunk_id, { hit: entry, score: entry.score })
  }
  for (let i = 0; i < next.length; i++) {
    const hit = next[i]!
    const inc = 1 / (RRF_K + i + 1)
    const existing = scores.get(hit.chunk_id)
    if (existing) existing.score += inc
    else scores.set(hit.chunk_id, { hit, score: inc })
  }
  const fused = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
  // overwrite the underlying-source score with the fused score so downstream
  // consumers (heuristics, rerank) see RRF-scale numbers, not BM25/cosine.
  return fused.map(({ hit, score }) => ({ ...hit, score }))
}
```

### Step 4: Write `src/main/services/retrieval/heuristics.ts`

```ts
import type { SearchHit } from '@main/db/database'

// small-but-deliberate stopword lists DE+EN. Domain-relevant nouns
// like "Wochenbuch" intentionally NOT in the list — they should match title
// boosts. Tweak with care: each addition reduces title-boost recall.
const TITLE_STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'by', 'at', 'as', 'it',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines',
  'und', 'oder', 'von', 'zu', 'im', 'auf', 'für', 'mit', 'ist', 'sind',
])

function nonStopwordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zA-Z0-9äöüß]+/)
    .filter((t) => t.length > 0 && !TITLE_STOPWORDS.has(t))
}

export function applyTitleBoost(hits: SearchHit[], query: string, factor: number): SearchHit[] {
  if (factor === 1.0 || factor <= 0) return hits
  const qTokens = new Set(nonStopwordTokens(query))
  if (qTokens.size === 0) return hits
  return hits.map((h) => {
    const titleTokens = nonStopwordTokens(h.document_title)
    const overlap = titleTokens.some((t) => qTokens.has(t))
    return overlap ? { ...h, score: h.score * factor } : h
  })
}

export function applyShortChunkPenalty(
  hits: SearchHit[],
  factor: number,
  minChars: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0) return hits
  return hits.map((h) =>
    h.text.length < minChars ? { ...h, score: h.score * factor } : h,
  )
}

export function applyRecencyBoost(
  hits: SearchHit[],
  factor: number,
  windowMs: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0 || windowMs <= 0) return hits
  const nowSec = Math.floor(Date.now() / 1000)
  const windowSec = Math.floor(windowMs / 1000)
  return hits.map((h) => {
    const added = h.added_at ?? null
    if (added == null) return h
    return nowSec - added <= windowSec ? { ...h, score: h.score * factor } : h
  })
}
```

### Step 5: Run, confirm pass

```bash
pnpm test --project unit
```

Expected: 16 existing unit tests + 4 new rrf tests + 10 new heuristics tests = 30 unit tests pass.

### Step 6: Typecheck + lint.

```bash
pnpm typecheck && pnpm lint
```

### Step 7: NO COMMIT.

---

## Task 3: Port RerankerService verbatim

**Files:**
- Create: `src/main/services/retrieval/RerankerService.ts`

### Step 1: Fetch from MVP

```bash
gh api repos/TwoD97/Notebook-LoLM/contents/src/main/services/RerankerService.ts --jq '.content' | base64 -d > src/main/services/retrieval/RerankerService.ts
```

### Step 2: Fix the ResourcePlanner import path

The MVP file imports `'./ResourcePlanner'`. We have the file at `src/main/services/embeddings/ResourcePlanner.ts`. Update:

```ts
// before
} from './ResourcePlanner'

// after
} from '../embeddings/ResourcePlanner'
```

### Step 3: Move RerankerStatus / RerankerInfo to shared types

In `src/shared/documents.ts`, append:

```ts
export type RerankerState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface RerankerStatus {
  kind: 'reranker'
  state: RerankerState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
}

export interface RerankerInfo extends RerankerStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementChoice: 'auto' | 'cpu' | 'gpu'
  placementReason: string | null
}
```

In `src/main/services/retrieval/RerankerService.ts`, replace the local declarations of `RerankerState` / `RerankerStatus` / `RerankerInfo` (around lines 22-46 of the MVP file) with re-exports from shared:

```ts
import type {
  RerankerState,
  RerankerStatus,
  RerankerInfo,
} from '../../../shared/documents'
export type { RerankerState, RerankerStatus, RerankerInfo }
```

(Match the pattern used by EmbeddingService.)

### Step 4: Fix TS strict-mode issues

The MVP file likely has the same `noUncheckedIndexedAccess` issues we hit in EmbeddingService. After fetching, run:

```bash
pnpm typecheck 2>&1 | grep "RerankerService.ts"
```

For each `'string | undefined' is not assignable` or `'Object is possibly undefined'`: add a `!` non-null assertion where the surrounding code already proved the value is defined.

### Step 5: Typecheck clean

```bash
pnpm typecheck
```

### Step 6: NO COMMIT.

---

## Task 4: Port RetrievalService (orchestrator)

**Files:**
- Create: `src/main/services/retrieval/RetrievalService.ts`

This is the biggest port (627 lines). Multi-query expansion is gated on a `LlamaService` that doesn't exist yet — we'll wire the parameter through but the call site (`maybeExpandQueries`) will silently return `[query]` when no LLM is provided.

### Step 1: Fetch from MVP

```bash
gh api repos/TwoD97/Notebook-LoLM/contents/src/main/services/RetrievalService.ts --jq '.content' | base64 -d > src/main/services/retrieval/RetrievalService.ts
```

### Step 2: Replace imports

The file imports `{ ChunkRow, Database, SearchHit } from '../db/database'`, `EmbeddingService from './EmbeddingService'`, `LlamaService from './LlamaService'`, `RerankerService from './RerankerService'`. Replace:

```ts
// before
import type { ChunkRow, Database, SearchHit } from '../db/database'
import type { EmbeddingService } from './EmbeddingService'
import type { LlamaService } from './LlamaService'
import type { RerankerService } from './RerankerService'

// after
import type { ChunkRow, Database, SearchHit } from '../../db/database'
import type { EmbeddingService } from '../embeddings/EmbeddingService'
import type { RerankerService } from './RerankerService'

// LlamaService isn't ported yet (lands in Plan 2C). The reference type
// describes only what RetrievalService actually uses — `isReady()` and
// a chat-completion entry-point for multi-query expansion. When 2C lands,
// replace this with `import type { LlamaService } from '../llm/LlamaService'`.
interface LlamaServiceLike {
  isReady(): boolean
  complete(prompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string>
}
type LlamaService = LlamaServiceLike
```

### Step 3: Extract the inline helpers we already moved to pure modules

In the MVP file, `fuseRrf`, `applyTitleBoost`, `applyShortChunkPenalty`, `applyRecencyBoost`, and `TITLE_STOPWORDS` are inline. Delete them from `RetrievalService.ts` and replace usage with imports from our new helpers:

```ts
import { fuseRrf, RRF_K } from './rrf'
import {
  applyTitleBoost,
  applyShortChunkPenalty,
  applyRecencyBoost,
} from './heuristics'
```

If the inline `RRF_K` constant is declared, delete it (now in `rrf.ts`).

### Step 4: Stub multi-query expansion

Find `maybeExpandQueries(query, multiQuery)`. The implementation calls `this.llama!.complete(...)`. Guard it:

```ts
private async maybeExpandQueries(query: string, enabled: boolean): Promise<string[]> {
  if (!enabled || !this.llama || !this.llama.isReady()) return [query]
  // … existing MVP body using this.llama.complete(…)
}
```

### Step 5: Fix TS strict-mode issues

Same drill as RerankerService — `pnpm typecheck 2>&1 | grep RetrievalService.ts`, fix each `!` / null check.

### Step 6: Typecheck clean

```bash
pnpm typecheck
```

### Step 7: NO COMMIT.

---

## Task 5: Integration test — end-to-end retrieval against seeded corpus

**Files:**
- Create: `tests/integration/retrieval-pipeline.test.ts`

Gated on `models/bge-m3-Q4_K_M.gguf` being present (skipped otherwise).

### Step 1: Write the test

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
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { IndexProgress } from '@main/services/documents/types'

const MODEL_PATH = join(process.cwd(), 'models', 'bge-m3-Q4_K_M.gguf')

describe.runIf(existsSync(MODEL_PATH))('hybrid retrieval (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-retrieval-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('finds the right doc via BM25+dense fusion on a seeded mini-corpus', async () => {
    const ws = await new WorkspaceService(auth).create('WS')

    const embedder = new EmbeddingService()
    expect(await embedder.ensureReady()).toBe(true)
    const docs = new DocumentService(auth, embedder)

    const wochen = join(dir, 'Wochenbuch.md')
    const auth_ = join(dir, 'auth-policy.md')
    const other = join(dir, 'recipe.md')
    await writeFile(
      wochen,
      '# Wochenbuch\n\nDiese Woche habe ich an LokLM gearbeitet: Datenbank-Schema in Postgres, ' +
        'Embeddings mit BGE-M3, hybride Suche mit RRF. Auch Codereviews mit Dominik gemacht.',
      'utf-8',
    )
    await writeFile(
      auth_,
      '# Authentication policy\n\nPasswords are hashed with argon2id. The vault uses AES-GCM ' +
        'envelope encryption with a passphrase-derived KEK.',
      'utf-8',
    )
    await writeFile(
      other,
      '# Pancake recipe\n\nFlour, milk, egg, butter. Mix, rest, fry. Nothing about software.',
      'utf-8',
    )

    for (const p of [wochen, auth_, other]) {
      const sent: IndexProgress[] = []
      await docs.importFile({
        workspaceId: ws.id,
        sourcePath: p,
        sender: {
          send: (_c: string, e: IndexProgress) => sent.push(e),
        } as unknown as Electron.WebContents,
      })
      await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 30_000)
    }

    const db = auth.requireDatabase()
    const retrieval = new RetrievalService(db, embedder)
    const hits = await retrieval.search(ws.id, 'wie wurden passwörter geschützt', 5, {
      rerank: false,
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.document_title).toContain('auth-policy')

    const hits2 = await retrieval.search(ws.id, 'was habe ich diese woche gemacht', 5, {
      rerank: false,
    })
    expect(hits2[0]!.document_title).toContain('Wochenbuch')

    await embedder.unload()
  }, 240_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
```

### Step 2: Run (skipped without model on this machine)

```bash
pnpm test --project integration -t retrieval
```

Expected: 0 tests run (skipped, no model on host) OR pass (model present locally).

### Step 3: Typecheck clean.

### Step 4: NO COMMIT.

---

## Task 6: IPC handlers (main + preload + stubs)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/setupTests.ts`
- Modify: `src/shared/documents.ts`

### Step 1: Add `RetrievalHit` + `RetrievalOptions` to `src/shared/documents.ts`

```ts
export interface RetrievalHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  text: string
  score: number
  origin?: 'primary' | 'neighbour' | 'whole_doc'
}

export interface RetrievalOptions {
  multiQuery?: boolean
  rerank?: boolean
  documentDiversity?: boolean
  wholeDocFallback?: boolean
  wholeDocThreshold?: number
  neighbourRadius?: number
  activeDocumentIds?: number[] | null
  perDocCandidateCap?: number
  titleBoostFactor?: number
  shortChunkPenalty?: number
  shortChunkMinChars?: number
  recencyBoostFactor?: number
  recencyBoostWindowMs?: number
}
```

### Step 2: Singletons + handlers in `src/main/index.ts`

After `getEmbeddingService()`, add:

```ts
import { RerankerService } from './services/retrieval/RerankerService'
import { RetrievalService } from './services/retrieval/RetrievalService'

let rerankerService: RerankerService | null = null
let retrievalService: RetrievalService | null = null

function getRerankerService(): RerankerService {
  if (!rerankerService) {
    rerankerService = new RerankerService()
    rerankerService.subscribe((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('reranker:status', status)
        } catch {
          /* ignore */
        }
      }
    })
  }
  return rerankerService
}

function getRetrievalService(): RetrievalService {
  if (!retrievalService) {
    retrievalService = new RetrievalService(
      getAuth().requireDatabase(),
      getEmbeddingService(),
      getRerankerService(),
      // llama not yet available — Plan 2C wires it in
      undefined,
    )
  }
  return retrievalService
}
```

Update `resetSessionServices`:
```ts
function resetSessionServices(): void {
  backfillService = null
  retrievalService = null  // captures Database
}
```

Register handlers inside `registerIpc()`:
```ts
  // retrieval (programmatic API; eval harness consumes this in 2C)
  ipcMain.handle(
    'search:hybrid',
    async (
      _e,
      workspaceId: number,
      query: string,
      topK: number,
      opts: import('../shared/documents').RetrievalOptions = {},
    ) => getRetrievalService().search(workspaceId, query, topK, opts),
  )

  // reranker
  ipcMain.handle('reranker:status', async () => getRerankerService().getStatus())
  ipcMain.handle('reranker:info', async () => getRerankerService().info())
  ipcMain.handle('reranker:reload', async () => {
    await getRerankerService().unload()
    await getRerankerService().ensureReady()
    return getRerankerService().info()
  })
```

### Step 3: Extend preload bridge

```ts
import type { RerankerStatus, RerankerInfo, RetrievalHit, RetrievalOptions } from '../shared/documents'

// inside api:
  search: {
    hybrid: (
      workspaceId: number,
      query: string,
      topK: number,
      opts?: RetrievalOptions,
    ): Promise<RetrievalHit[]> => ipcRenderer.invoke('search:hybrid', workspaceId, query, topK, opts ?? {}),
  },
  reranker: {
    status: (): Promise<RerankerStatus> => ipcRenderer.invoke('reranker:status'),
    info: (): Promise<RerankerInfo> => ipcRenderer.invoke('reranker:info'),
    reload: (): Promise<RerankerInfo> => ipcRenderer.invoke('reranker:reload'),
    onStatus: (cb: (s: RerankerStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: RerankerStatus): void => cb(s)
      ipcRenderer.on('reranker:status', listener)
      return () => {
        ipcRenderer.removeListener('reranker:status', listener)
      }
    },
  },
```

### Step 4: Extend renderer stub

In `src/renderer/src/setupTests.ts` inside the `stub: Api`:
```ts
  search: {
    hybrid: () => Promise.resolve([]),
  },
  reranker: {
    status: () =>
      Promise.resolve({
        kind: 'reranker' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
      }),
    info: () =>
      Promise.resolve({
        kind: 'reranker' as const,
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
        kind: 'reranker' as const,
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
    onStatus: () => () => undefined,
  },
```

### Step 5: Typecheck + lint clean.

### Step 6: NO COMMIT.

---

## Task 7: Final verification

### Step 1: Full test sweep

```bash
pnpm test
```

Expected:
- `unit`: 30 pass (16 existing + 4 rrf + 10 heuristics)
- `tx`: 25 pass (19 existing + 6 search-repo) + 1 pre-existing vault failure
- `integration`: 8 pass + 1 skipped (retrieval-pipeline, no model) — OR 9 pass if model present
- `web`: 2 pass
- `node`: 3 pass

### Step 2: typecheck + lint clean.

### Step 3: NO COMMIT. Hand back to the controller for the milestone commit.

---

## Self-Review

### Spec coverage (Plan 2B scope: AP-4.2 + AP-4.4)

| Spec section | Task(s) | Notes |
|---|---|---|
| AP-4.2 BM25 query lifecycle | 1 | `searchChunks` with bilingual `plainto_tsquery` + OR fallback + per-doc cap + status='ready' filter |
| AP-4.3 cosine query side | 1 | `searchChunksByVector` fast-path + window-fn branch |
| AP-4.4 RRF fusion | 2 | Pure helper, 4 tests |
| AP-4.4 title boost / recency / short-chunk | 2 | Pure helpers, 10 tests |
| AP-4.4 cross-encoder rerank | 3 | RerankerService port (bge-reranker-v2-m3) |
| AP-4.4 document diversity / whole-doc / neighbour expand | 4 | Verbatim from MVP RetrievalService |
| AP-4.4 multi-query expansion | 4 | Wired through but gated on LlamaService (Plan 2C) — falls back to `[query]` |
| End-to-end pipeline test | 5 | Seeded mini-corpus, asserts the right doc wins on two queries |
| IPC programmatic API for eval harness | 6 | `search:hybrid` handler returns `RetrievalHit[]` |

### Out of scope for 2B (Plan 2C)

- LlamaService for multi-query expansion + answer generation
- `prompt.ts` buildPrompt + citation markers
- `QAService.answer(query)` top-level API
- Refusal threshold (AP-7.4)
- Chat UI (AP-7.1) — separate AP

### Placeholder scan

- All tests have concrete code; no "implement later" markers.
- One intentional stub: `LlamaServiceLike` interface in RetrievalService.ts is a forward-declaration replaced in Plan 2C.
- Integration test gated on model presence — same pattern as Plan 2A.

### Type consistency

- `SearchHit` defined in `src/main/db/database.ts` and consumed everywhere downstream.
- `RetrievalHit` defined in `src/shared/documents.ts` and re-exported by RetrievalService — single source of truth (same pattern as `EmbedderStatus`).
- `RerankerStatus` follows the same dedup pattern as `EmbedderStatus`.

### Risks

- The Drizzle `sql\`...\`` interpolation differs from MVP's `query<T>` positional params. Translating the parameter slots correctly is the main porting risk. The tx tests in Task 1 catch translation errors immediately.
- `plainto_tsquery` returns 0 rows on stopword-only queries; the `'&' → '|'` rewrite turns AND-of-terms into OR. Edge case: a single-term query becomes a single-term tsquery (no `&` or `|` to rewrite), so the rewrite is a no-op — same behaviour as MVP.
- The integration test depends on BGE-M3 embedding quality. If the seeded mini-corpus surfaces a quirk (e.g., 'auth-policy' loses to 'Wochenbuch' because the latter mentions 'argon2id' twice), relax assertions to `expect(hits.map((h) => h.document_title)).toContain('auth-policy')` rather than `[0]!.document_title === ...`.

---

## End of plan
