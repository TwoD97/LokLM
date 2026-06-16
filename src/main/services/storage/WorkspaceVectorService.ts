import type { AuthService } from '../auth/AuthService'
import type { SearchHit } from '../../db/database'
import type { VectorRecord, VectorStore } from './VectorStore'

// Bridge between the app's relational world (workspace ids, chunk text in PGlite)
// and the per-workspace encrypted LanceDB vector stores (ADR-0005).
//
// - ensures the VaultManifest has an entry mirroring each relational workspace,
// - opens the active workspace's encrypted Lance store on demand,
// - on first open, migrates any legacy pgvector embeddings for that workspace
//   into Lance so existing libraries keep working after the swap,
// - search() returns fully-hydrated SearchHit rows (Lance gives ids+scores, the
//   text/title/page come from PGlite by chunkId), so callers are unchanged.

export interface VectorSearchOpts {
  activeDocumentIds?: number[] | null
  perDocK?: number
}

export class WorkspaceVectorService {
  private readonly migrated = new Set<number>()

  constructor(private readonly auth: AuthService) {}

  async upsert(workspaceId: number, records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    const store = await this.storeFor(workspaceId)
    await store.upsert(records)
  }

  async remove(workspaceId: number, chunkIds: number[]): Promise<void> {
    if (chunkIds.length === 0) return
    const store = await this.storeFor(workspaceId)
    await store.remove(chunkIds)
  }

  async search(
    workspaceId: number,
    queryVec: number[],
    topK: number,
    opts: VectorSearchOpts = {},
  ): Promise<SearchHit[]> {
    const store = await this.storeFor(workspaceId)
    const active = opts.activeDocumentIds
    const hits = await store.search(queryVec, topK, {
      ...(active && active.length > 0 ? { activeDocumentIds: active } : {}),
      ...(opts.perDocK ? { perDocK: opts.perDocK } : {}),
    })
    return this.auth.requireDatabase().documents().hydrateChunkHits(hits, workspaceId)
  }

  private async storeFor(workspaceId: number): Promise<VectorStore> {
    const wsStore = this.auth.getWorkspaceStore()
    await wsStore.ensure(workspaceId, await this.workspaceName(workspaceId))
    const store = await wsStore.open(workspaceId)
    await this.migrateIfNeeded(workspaceId, store)
    return store
  }

  private async workspaceName(workspaceId: number): Promise<string> {
    const list = await this.auth.requireDatabase().workspaces().list()
    return list.find((w) => w.id === workspaceId)?.name ?? `ws-${workspaceId}`
  }

  /** One-time, idempotent copy of legacy pgvector embeddings → Lance, the first
   *  time a workspace's (empty) store is opened. */
  private async migrateIfNeeded(workspaceId: number, store: VectorStore): Promise<void> {
    if (this.migrated.has(workspaceId)) return
    this.migrated.add(workspaceId)
    if ((await store.count()) > 0) return
    const repo = this.auth.requireDatabase().documents()
    const legacy = await repo.listChunkVectors(workspaceId)
    if (legacy.length > 0) {
      await store.upsert(legacy)
      await store.buildIndex()
      // Reclaim the in-memory PGlite footprint: the vectors now live in Lance,
      // the `embedded` marker stays set, so retrieval + bookkeeping are intact.
      await repo.clearLegacyVectors(workspaceId)
    }
  }
}
