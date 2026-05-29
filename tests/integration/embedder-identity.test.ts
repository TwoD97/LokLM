import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { Database } from '@main/db/database'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import { ProviderRegistry } from '@main/services/providers/Registry'
import type {
  EmbedderProvider,
  LlmProvider,
  RerankerProvider,
} from '@main/services/providers/types'

// pgvector column on `chunks` is declared vector(1024) — both stub embedders
// must produce 1024-dim output or setChunkEmbedding will fail with a
// dimension-mismatch error. The identity round-trip is the only thing this
// test exercises; vector content is irrelevant beyond "non-zero so cosine
// doesn't blow up".
const DIM = 1024

function mkEmbedder(id: string, seed = 0.1): EmbedderProvider {
  return {
    embed: async (texts) => texts.map(() => Float32Array.from(new Array(DIM).fill(seed))),
    dimension: () => DIM,
    identity: () => id,
    isReady: () => true,
    ensureReady: async () => {},
  }
}

function mkLlm(): LlmProvider {
  return {
    ask: async () => 'ok',
    generateRaw: async () => '',
    generateTitle: async () => null,
    contextWindowTokens: () => 0,
    isReady: () => true,
    getStatus: () => ({ ready: true, message: null, identity: 'stub' }),
    getModelStatus: () => ({}) as never,
    setLanguage: async () => {},
  }
}

function mkReranker(): RerankerProvider {
  return {
    rerank: async (_q, p) => p.map((_, i) => 1 - i * 0.01),
    isReady: () => true,
    ensureReady: async () => {},
  }
}

describe('embedder identity round-trip', () => {
  let db: Database
  let registry: ProviderRegistry
  let workspaceId: number
  let chunkId: number

  beforeEach(async () => {
    db = await Database.create(undefined)
    const ws = await db.workspaces().create('w1')
    workspaceId = ws.id
    const doc = await db.documents().addDocument({
      workspaceId: ws.id,
      title: 't',
      sourcePath: '/x',
      mimeType: null,
      byteSize: null,
    })
    await db.documents().setDocumentStatus(doc.id, 'ready')
    await db
      .documents()
      .persistChunks(doc.id, [
        { ordinal: 0, text: 'hello', pageFrom: null, pageTo: null, tokenCount: 1 },
      ])
    const r = await db.db.execute(sql`SELECT id FROM chunks WHERE document_id = ${doc.id}`)
    chunkId = (r.rows as Array<{ id: number }>)[0]!.id

    // Two embedders that produce distinct identities. Both 1024-dim so the
    // pgvector column accepts writes from either; only `identity()` differs.
    registry = new ProviderRegistry({
      llm: { bundled: mkLlm(), ollama: null },
      embedder: {
        bundled: mkEmbedder('bundled:bge-m3', 0.1),
        ollama: mkEmbedder('ollama:nomic-embed-text', 0.2),
      },
      reranker: { bundled: mkReranker(), ollama: null },
    })
    registry.setEmbedderSource('bundled')
  })

  afterEach(async () => {
    await db.close()
  })

  it('tags newly-embedded chunks with the active embedder identity', async () => {
    const svc = new EmbeddingBackfillService(db, registry)
    await svc.run(workspaceId)
    const r = await db.db.execute(sql`SELECT embedder_identity FROM chunks WHERE id = ${chunkId}`)
    expect((r.rows as Array<{ embedder_identity: string }>)[0]!.embedder_identity).toBe(
      'bundled:bge-m3',
    )
  })

  it('purges stale chunks and re-embeds on next run after embedder switch', async () => {
    // First pass: bundled identity tags the chunk + writes a vector.
    const svc = new EmbeddingBackfillService(db, registry)
    await svc.run(workspaceId)
    let r = await db.db.execute(
      sql`SELECT embedder_identity, embedding FROM chunks WHERE id = ${chunkId}`,
    )
    let row = (r.rows as Array<{ embedder_identity: string; embedding: unknown }>)[0]!
    expect(row.embedder_identity).toBe('bundled:bge-m3')
    expect(row.embedding).not.toBeNull()

    // Flip embedder source — registry now hands out the ollama embedder with
    // a different identity. Backfill should purge the stale row (set
    // embedding=NULL) then immediately re-embed it under the new identity.
    registry.setEmbedderSource('ollama')
    await svc.run(workspaceId)
    r = await db.db.execute(
      sql`SELECT embedder_identity, embedding FROM chunks WHERE id = ${chunkId}`,
    )
    row = (r.rows as Array<{ embedder_identity: string; embedding: unknown }>)[0]!
    expect(row.embedder_identity).toBe('ollama:nomic-embed-text')
    expect(row.embedding).not.toBeNull()
  })
})
