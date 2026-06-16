import type { AuthService } from '../auth/AuthService'
import type { SearchHit } from '../../db/types'
import type { VectorRecord, VectorStore } from './VectorStore'

// Bridge between the per-workspace relational store (encrypted SQLite) and the
// per-workspace encrypted LanceDB vector store (ADR-0005).
//
// - ensures the VaultManifest has an entry for the workspace,
// - opens the active workspace's encrypted Lance store on demand,
// - search() returns fully-hydrated SearchHit rows (Lance gives ids+scores, the
//   text/title/page come from the workspace SQLite by chunkId),
// - on first open, if the Lance store is empty but chunks are marked embedded
//   (vectors lost/corrupt), resets the markers so the backfill re-embeds from
//   chunk text (the SQLite store holds the text — no data loss).

export interface VectorSearchOpts {
  activeDocumentIds?: number[] | null
  perDocK?: number
}

export class WorkspaceVectorService {
  private readonly reconciled = new Set<number>()

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
    const metaDb = await this.auth.getWorkspaceDb(workspaceId)
    return metaDb.hydrateChunkHits(hits)
  }

  private async storeFor(workspaceId: number): Promise<VectorStore> {
    const wsStore = this.auth.getWorkspaceStore()
    await wsStore.ensure(workspaceId, this.workspaceName(workspaceId))
    const store = await wsStore.open(workspaceId)
    await this.reconcileOnOpen(workspaceId, store)
    return store
  }

  private workspaceName(workspaceId: number): string {
    return (
      this.auth
        .getWorkspaceStore()
        .list()
        .find((w) => w.id === workspaceId)?.name ?? `ws-${workspaceId}`
    )
  }

  /** Idempotent (once per session): the first time a workspace's Lance store is
   *  opened and found empty while chunks are still marked embedded, the vectors
   *  were lost/corrupt (e.g. quarantined on open) — reset the markers in the
   *  workspace SQLite so the backfill re-embeds from chunk text (no data loss). */
  private async reconcileOnOpen(workspaceId: number, store: VectorStore): Promise<void> {
    if (this.reconciled.has(workspaceId)) return
    this.reconciled.add(workspaceId)
    if ((await store.count()) > 0) return // vectors present — nothing to do
    const metaDb = await this.auth.getWorkspaceDb(workspaceId)
    const reset = await metaDb.resetEmbeddedMarkers()
    if (reset > 0) {
      console.warn(
        `[workspace ${workspaceId}] ${reset} chunks have no vector — marked for re-embedding`,
      )
    }
  }
}
