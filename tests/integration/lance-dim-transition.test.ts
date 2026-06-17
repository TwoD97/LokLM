import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LanceWorkspaceStore } from '@main/services/storage/LanceWorkspaceStore'
import { suggestIndexConfig } from '@shared/workspaceStorage'

// ADR-0006 regression: a codebase workspace can change embedding model — and
// therefore vector dimension — after it was first indexed (BGE-M3 1024 →
// jina-code 896, applied by the model-swap backfill). A LanceDB fixed-size-list
// vector column is single-dim, so the store must rebuild the table on a dim
// change instead of failing the merge, and search with a mismatched query
// vector must degrade gracefully rather than throwing
// "No vector column found to match with the query vector dimension".

function vec(dim: number, seed: number): number[] {
  // Deterministic unit-ish vector; exact values don't matter for the test.
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i) * 0.01)
}

describe('LanceWorkspaceStore embedding-dimension transition (integration)', () => {
  let dir: string
  let store: LanceWorkspaceStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-lance-dim-'))
    store = new LanceWorkspaceStore({
      workspaceId: 1,
      config: suggestIndexConfig(1024, 0),
      datasetDir: dir,
    })
    await store.open()
  })

  afterEach(async () => {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('rebuilds the table when the vector dimension changes (1024 → 896)', async () => {
    // First indexing pass: BGE-M3, 1024 dims.
    await store.upsert([
      { chunkId: 1, documentId: 1, vector: vec(1024, 1) },
      { chunkId: 2, documentId: 1, vector: vec(1024, 2) },
    ])
    expect(await store.count()).toBe(2)

    // Model-swap backfill purges the old-stem vectors, then re-embeds at 896.
    await store.remove([1, 2])
    await expect(
      store.upsert([
        { chunkId: 1, documentId: 1, vector: vec(896, 1) },
        { chunkId: 2, documentId: 1, vector: vec(896, 2) },
      ]),
    ).resolves.not.toThrow()
    expect(await store.count()).toBe(2)

    // Search with an 896-dim query must work against the rebuilt 896 table.
    const hits = await store.search(vec(896, 1), 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.map((h) => h.chunkId).sort()).toEqual([1, 2])
  })

  it('returns [] (no throw) when the query dim does not match the table dim', async () => {
    await store.upsert([{ chunkId: 1, documentId: 1, vector: vec(1024, 1) }])
    // A codebase workspace whose query embedder is now jina-code (896) but whose
    // table is still BGE-M3 (1024) — before the re-embed completes. Must not crash.
    const hits = await store.search(vec(896, 1), 5)
    expect(hits).toEqual([])
  })
})
