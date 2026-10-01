import type { AuthService } from '../auth/AuthService'
import type { SearchHit } from '../../db/types'
import type { VectorRecord, VectorStore } from './VectorStore'
import type { WorkspaceStore } from './WorkspaceStore'
import type { WorkspaceDb } from '../../db/sqlite/WorkspaceDb'

// Bridge between the per-workspace relational store (encrypted SQLite) and the
// per-workspace encrypted LanceDB vector store (ADR-0005).
//
// - uses only existing VaultManifest entries (background work cannot recreate a
//   workspace after deletion),
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
  private readonly reconciling = new Map<number, Promise<void>>()
  private readonly workspaceStore: WorkspaceStore

  constructor(auth: AuthService) {
    // A suspended vector operation must never resolve a new login's same-ID
    // workspace through AuthService. The old store rejects opens after close.
    this.workspaceStore = auth.getWorkspaceStore()
  }

  async upsert(workspaceId: number, records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.withStore(workspaceId, async (store, metadata) => {
      // An embedding may finish after its document was deleted/reindexed.
      // Check ownership inside the vector FIFO, not before waiting for it.
      // Document mutations retire SQLite rows before queuing their vector
      // purge: a write already admitted here therefore finishes before that
      // purge, while later writes cannot restore the retired chunk IDs.
      const owners = await metadata.chunkOwners(records.map((record) => record.chunkId))
      const live = records.filter((record) => owners.get(record.chunkId) === record.documentId)
      if (live.length > 0) await store.upsert(live)
    })
  }

  async remove(workspaceId: number, chunkIds: number[]): Promise<void> {
    if (chunkIds.length === 0) return
    await this.withStore(workspaceId, (store) => store.remove(chunkIds))
  }

  async search(
    workspaceId: number,
    queryVec: number[],
    topK: number,
    opts: VectorSearchOpts = {},
  ): Promise<SearchHit[]> {
    return this.withStore(workspaceId, async (store, metaDb) => {
      const active = opts.activeDocumentIds
      const hits = await store.search(queryVec, topK, {
        ...(active && active.length > 0 ? { activeDocumentIds: active } : {}),
        ...(opts.perDocK ? { perDocK: opts.perDocK } : {}),
      })
      return metaDb.hydrateChunkHits(hits)
    })
  }

  private async withStore<T>(
    workspaceId: number,
    operation: (store: VectorStore, metadata: WorkspaceDb) => Promise<T>,
  ): Promise<T> {
    return this.workspaceStore.withVectorStore(workspaceId, async (store, metadata) => {
      await this.reconcileOnOpen(workspaceId, store, metadata)
      return operation(store, metadata)
    })
  }

  /** Idempotent (once per session): the first time a workspace's Lance store is
   *  opened and found empty while chunks are still marked embedded, the vectors
   *  were lost/corrupt (e.g. quarantined on open) — reset the markers in the
   *  workspace SQLite so the backfill re-embeds from chunk text (no data loss). */
  private async reconcileOnOpen(
    workspaceId: number,
    store: VectorStore,
    metaDb: WorkspaceDb,
  ): Promise<void> {
    if (this.reconciled.has(workspaceId)) return
    const existing = this.reconciling.get(workspaceId)
    if (existing) return existing
    const run = (async () => {
      if ((await store.count()) === 0) {
        const reset = await metaDb.resetEmbeddedMarkers()
        if (reset > 0) {
          console.warn(
            `[workspace ${workspaceId}] ${reset} chunks have no vector — marked for re-embedding`,
          )
        }
      }
      // A failed/canceled probe remains retryable; parallel callers wait for
      // the same reconciliation before writing or reading the vector store.
      this.reconciled.add(workspaceId)
    })()
    this.reconciling.set(workspaceId, run)
    try {
      await run
    } finally {
      if (this.reconciling.get(workspaceId) === run) this.reconciling.delete(workspaceId)
    }
  }
}
