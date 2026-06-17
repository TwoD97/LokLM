import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { RetrievalService } from '../../src/main/services/retrieval/RetrievalService'
import { WorkspaceDb } from '../../src/main/db/sqlite/WorkspaceDb'
import type { WorkspaceDbFacade } from '../../src/main/services/storage/WorkspaceDbFacade'
import type { ProviderRegistry } from '../../src/main/services/providers/Registry'

// ADR-0005 stage 3b: RetrievalService routes its relational/BM25 reads to the
// per-workspace libSQL store when a getWorkspaceDb accessor is injected. With no
// embedder ready it's a BM25-only run, exercising the libSQL FTS5 path through
// the real service (not just the repo).

const noEmbedderRegistry = {
  embedder: () => ({ isReady: () => false, embed: async () => [] }),
  reranker: () => ({ isReady: () => false }),
  llm: () => ({ isReady: () => false, getModelStatus: () => ({ gpu: null }) }),
} as unknown as ProviderRegistry

describe('RetrievalService over libSQL (BM25)', () => {
  let dir: string
  let wsdb: WorkspaceDb

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'loklm-retlibsql-'))
    wsdb = await WorkspaceDb.open(join(dir, 'meta.db'), randomBytes(32).toString('hex'), 1)
    const doc = await wsdb.addDocument({ title: 'Cell Bio', sourcePath: '/c.txt', status: 'ready' })
    await wsdb.persistChunks(doc.id, [
      {
        ordinal: 0,
        text: 'the mitochondria is the powerhouse of the cell',
        pageFrom: 1,
        pageTo: 1,
        tokenCount: 8,
      },
      {
        ordinal: 1,
        text: 'ribosomes synthesise proteins from amino acids',
        pageFrom: 1,
        pageTo: 1,
        tokenCount: 6,
      },
    ])
  })
  afterEach(async () => {
    wsdb.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns BM25 hits from the workspace libSQL store via the service', async () => {
    const retrieval = new RetrievalService(
      null as unknown as WorkspaceDbFacade, // unused: wsdb path + no embedder
      noEmbedderRegistry,
      undefined,
      async () => wsdb,
    )
    const hits = await retrieval.search(1, 'mitochondria', 5, { rerank: false })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('mitochondria')
    expect(hits[0]!.document_title).toBe('Cell Bio')
  })
})
