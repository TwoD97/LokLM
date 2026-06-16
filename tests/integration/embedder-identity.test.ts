import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import { ProviderRegistry } from '@main/services/providers/Registry'
import type {
  EmbedderProvider,
  LlmProvider,
  RerankerProvider,
} from '@main/services/providers/types'

// ADR-0005: chunk vectors now live in the per-workspace encrypted LanceDB store;
// the SQLite `embedded` marker + `embedder_identity` track which embedder
// produced them. This test exercises the identity round-trip + model-swap purge
// against the facade; a vectorSink stub stands in for the LanceDB write.
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
  let dir: string
  let auth: AuthService
  let registry: ProviderRegistry
  let workspaceId: number
  // Captures the vectors written to the (LanceDB-backed) sink so the test can
  // prove a re-embed happened without a real Lance store.
  let sink: Map<number, number[]>

  const vectorSink = async (
    _ws: number,
    records: Array<{ chunkId: number; documentId: number; vector: number[] }>,
  ): Promise<void> => {
    for (const r of records) sink.set(r.chunkId, r.vector)
  }
  const vectorRemove = async (_ws: number, chunkIds: number[]): Promise<void> => {
    for (const id of chunkIds) sink.delete(id)
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-emb-id-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
    const ws = await new WorkspaceService(auth).create('w1')
    workspaceId = ws.id
    await auth.activate(ws.id)
    sink = new Map()

    const db = auth.requireDatabase()
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

    // Two embedders that produce distinct identities; only `identity()` differs.
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
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('tags newly-embedded chunks with the active embedder identity', async () => {
    const svc = new EmbeddingBackfillService(
      auth.requireDatabase(),
      registry,
      vectorSink,
      vectorRemove,
    )
    await svc.run(workspaceId)
    const ids = await auth.requireDatabase().documents().distinctEmbedderIdentities(workspaceId)
    expect(ids).toContain('bundled:bge-m3')
    expect(sink.size).toBe(1)
  })

  it('purges stale chunks and re-embeds on next run after embedder switch', async () => {
    const svc = new EmbeddingBackfillService(
      auth.requireDatabase(),
      registry,
      vectorSink,
      vectorRemove,
    )
    await svc.run(workspaceId)
    expect(
      await auth.requireDatabase().documents().distinctEmbedderIdentities(workspaceId),
    ).toEqual(['bundled:bge-m3'])
    expect(sink.size).toBe(1)

    // Flip embedder source — backfill should purge the stale chunk then
    // immediately re-embed it under the new identity.
    registry.setEmbedderSource('ollama')
    await svc.run(workspaceId)
    expect(
      await auth.requireDatabase().documents().distinctEmbedderIdentities(workspaceId),
    ).toEqual(['ollama:nomic-embed-text'])
    expect(sink.size).toBe(1)
  })
})
