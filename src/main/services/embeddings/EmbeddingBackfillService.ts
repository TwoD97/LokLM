import { BrowserWindow } from 'electron'
import type { WorkspaceDbFacade } from '../storage/WorkspaceDbFacade'
import type { ProviderRegistry } from '../providers/Registry'
import type { BackfillStatus } from '../../../shared/documents'
import { embedderModelStem } from './EmbeddingService'

// re-export so callers in main process can keep importing from this file.
export type { BackfillStatus }

const PAGE = 32

/**
 * One-shot per workspace: walks `chunks` rows whose embedding IS NULL, embeds
 * them in pages, and writes vectors back. Triggered after the embedder warms
 * (so the user's existing library catches up without re-import) and after
 * cold imports that happened while the embedder was unavailable.
 *
 * Per-workspace dedup: a second call while one is running is a no-op, but
 * status() returns live progress so the renderer banner can display it.
 */
export class EmbeddingBackfillService {
  private active = new Map<number, BackfillStatus>()
  private listeners: Array<(s: BackfillStatus) => void> = []
  // Set by cancelAll() (app-quit drain). Checked at each loop boundary so a
  // long catch-up ends cleanly before the workspace store is closed. Permanent
  // once set — the process is on its way down, so no run() resets it.
  private stopRequested = false
  // Monotonic count of backfill progress events (one tick per status push, i.e.
  // per embedded batch). The app-quit drain watches this alongside
  // DocumentService's so a slow-but-working backfill reads as progress.
  private progressTicks = 0

  constructor(
    private readonly db: WorkspaceDbFacade,
    private readonly registry: ProviderRegistry,
    /** ADR-0005: writes backfilled embeddings into the per-workspace encrypted
     *  LanceDB store. When present, vectors go to Lance only and PGlite records
     *  just the `embedded` marker (markChunksEmbedded); when absent (isolated
     *  tests) the vector is stored in the legacy pgvector column. */
    private readonly vectorSink?: (
      workspaceId: number,
      records: Array<{ chunkId: number; documentId: number; vector: number[] }>,
    ) => Promise<void>,
    /** ADR-0005: removes stale vectors from the Lance store on a model-swap purge. */
    private readonly vectorPurge?: (workspaceId: number, chunkIds: number[]) => Promise<void>,
  ) {}

  subscribe(cb: (s: BackfillStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  /** True while a backfill is actively embedding in any workspace. Consulted by
   *  the vault's inactivity auto-lock guard so a long catch-up run isn't torn
   *  down mid-batch by the 15 min idle lock (which drops this service and closes
   *  the workspace store the embed loop writes into). */
  isAnyRunning(): boolean {
    for (const s of this.active.values()) {
      if (s.state === 'running') return true
    }
    return false
  }

  /** Ask every running backfill to stop at its next batch boundary. Per-batch
   *  writes are already durable, so nothing embedded is lost; the remaining
   *  NULL chunks are re-embedded by the next launch's backfill. Used by the
   *  app-quit drain to end the loop before lock() closes the store. */
  cancelAll(): void {
    this.stopRequested = true
  }

  /** Monotonic progress counter (one tick per embedded batch). The app-quit
   *  drain polls it to wait adaptively while embedding advances. */
  embedProgressTicks(): number {
    return this.progressTicks
  }

  status(workspaceId: number): BackfillStatus {
    return (
      this.active.get(workspaceId) ?? {
        workspaceId,
        state: 'idle',
        done: 0,
        total: 0,
        message: null,
      }
    )
  }

  async run(workspaceId: number): Promise<void> {
    const existing = this.active.get(workspaceId)
    if (existing && existing.state === 'running') return

    const embedder = this.registry.embedder()
    // ensureReady is void on the provider contract; probe readiness via
    // isReady() to keep the "no embedder model — skip backfill" branch that
    // the bundled embedder used to flag via a `false` return.
    await embedder.ensureReady()
    if (!embedder.isReady()) {
      this.update({
        workspaceId,
        state: 'failed',
        done: 0,
        total: 0,
        message: 'Embedder not available — vector backfill skipped.',
      })
      return
    }

    // Identity round-trip: before processing missing-embedding rows, null out
    // any pre-existing vectors that were produced by a *different* underlying
    // model. "Different" is judged by `embedderModelStem` — both bundled BGE-M3
    // and an Ollama-served BGE-M3 (regardless of quantisation tag) collapse to
    // the same stem, so flipping the source doesn't trigger a re-embed when
    // the model is functionally identical. A genuine model swap (bge-m3 →
    // nomic-embed-text) does have different stems and still gets purged so
    // the same backfill loop below can refill the NULLs cleanly.
    // App-quit drain: a cancelAll() during this pre-loop phase (before the first
    // 'running' update below, so isAnyRunning() is still false and the drain
    // doesn't wait for us) must abort BEFORE the identity purge — its meta.db +
    // Lance writes would otherwise race the lock()-triggered store close.
    if (this.stopRequested) return
    const activeIdentity = embedder.identity()
    const activeStem = embedderModelStem(activeIdentity)
    const existingIdentities = await this.db.documents().distinctEmbedderIdentities(workspaceId)
    const incompatibleIdentities = existingIdentities.filter(
      (id) => embedderModelStem(id) !== activeStem,
    )
    const purgedIds: number[] = []
    for (const id of incompatibleIdentities) {
      purgedIds.push(...(await this.db.documents().purgeEmbeddingsByIdentity(workspaceId, id)))
    }
    if (purgedIds.length > 0) {
      // ADR-0005: the stale vectors also live in LanceDB — drop them there so
      // they aren't served until the loop below re-embeds with the new model.
      if (this.vectorPurge) {
        try {
          await this.vectorPurge(workspaceId, purgedIds)
        } catch (err) {
          console.warn('[backfill] vector purge (Lance) failed:', err)
        }
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] purged ${purgedIds.length} stale chunks (stem ${incompatibleIdentities
          .map(embedderModelStem)
          .join(', ')} != ${activeStem})`,
      )
    }

    // Snapshot of pending work. NOT const: concurrent indexing (FolderSyncService
    // walking a freshly-opened codebase) inserts new no-vector chunks AFTER this
    // count, and the loop below drains them too — so `total` is grown in-loop to
    // stay ≥ done, otherwise done/total overshoots 100% in the progress UI.
    let total = await this.db.documents().countChunksMissingEmbedding(workspaceId)
    // Note: no early-return when total === 0 — the summary-embedding phase
    // below still has to run (a workspace whose chunks are all embedded can
    // still have freshly-cached summaries awaiting their vector).
    this.update({
      workspaceId,
      state: 'running',
      done: 0,
      total,
      message: total > 0 ? `Embedding ${total} pending chunks…` : 'Embedding summaries…',
    })

    let done = 0
    // Runaway-loop guard. Two ways the loop used to spin forever, both seen
    // in the field as "1062/1" status:
    //   1) The embedder is broken (returns null vectors for everything),
    //      so chunks stay embedding=NULL forever and the SAME batch comes
    //      back from listChunksMissingEmbedding on every iteration.
    //   2) setChunkEmbedding silently fails (e.g. pgvector dimension
    //      mismatch with a swapped model) — same end-state.
    // We track per-batch progress and bail out the moment we make none.
    let consecutiveNoProgress = 0
    try {
      // Loop until no more nulls. Each page round-trips the embedder, so
      // PAGE=32 keeps memory bounded and gives the renderer frequent updates.
      for (;;) {
        // App-quit drain (cancelAll): stop at this batch boundary so the store
        // close that follows can't tear a write. Everything embedded so far is
        // durable; remaining NULLs are picked up by the next launch's backfill.
        if (this.stopRequested) {
          this.update({ workspaceId, state: 'idle', done, total, message: null })
          return
        }
        const batch = await this.db.documents().listChunksMissingEmbedding(workspaceId, PAGE)
        if (batch.length === 0) break
        // Grow the denominator to cover work discovered after the initial snapshot
        // (concurrent indexing), keeping total ≥ done so progress never exceeds 100%.
        total = Math.max(total, done + batch.length)
        // Provider.embed throws on failure (where the old EmbeddingService
        // returned per-item nulls). Treat any throw as "made no progress for
        // this batch" so the runaway-loop guard catches a broken embedder
        // after 2 consecutive empty passes.
        let vectors: Float32Array[] | null
        try {
          vectors = await embedder.embed(batch.map((b) => b.text))
        } catch {
          vectors = null
        }
        let madeProgress = 0
        if (vectors) {
          // Collect the batch's successful (id, vector) pairs and write them
          // all in one UPDATE … FROM (VALUES …) , the per-row UPDATE was the
          // dominant cost on a hot backfill (32 round-trips per page).
          const writes: Array<{ id: number; vector: Float32Array }> = []
          const sinkRecords: Array<{ chunkId: number; documentId: number; vector: number[] }> = []
          for (let i = 0; i < batch.length; i++) {
            const v = vectors[i]
            const row = batch[i]
            if (!v || !row) continue
            writes.push({ id: row.id, vector: v })
            sinkRecords.push({
              chunkId: row.id,
              documentId: row.document_id,
              vector: Array.from(v),
            })
          }
          if (writes.length > 0) {
            try {
              if (this.vectorSink) {
                // ADR-0005 app path: vectors go to LanceDB only; PGlite just
                // records the embedded marker + identity (no pgvector write).
                await this.vectorSink(workspaceId, sinkRecords)
                await this.db.documents().markChunksEmbedded(
                  writes.map((w) => w.id),
                  activeIdentity,
                )
              } else {
                // Legacy / isolated-test path: store the vector in pgvector.
                await this.db.documents().setChunkEmbeddingsBatch(writes, activeIdentity)
              }
              madeProgress = writes.length
            } catch (err) {
              // Most likely a pgvector dimension mismatch (the model was
              // swapped after the column type was set). Surface it once and
              // bail — re-trying every batch would just spam logs.
              throw new Error(
                `Failed to write embeddings for ${writes.length} chunks ` +
                  `(sample id ${writes[0]?.id}): ${
                    err instanceof Error ? err.message : String(err)
                  }`,
              )
            }
          }
        }
        if (madeProgress === 0) {
          consecutiveNoProgress++
          if (consecutiveNoProgress >= 2) {
            const sampleId = batch[0]?.id
            throw new Error(
              `Embedder returned no usable vectors for ${batch.length} chunks ` +
                `(sample id ${sampleId}). Backfill aborted to avoid a runaway ` +
                `loop. Check that the embedder model is loaded and matches the ` +
                `pgvector column dimension.`,
            )
          }
        } else {
          consecutiveNoProgress = 0
          done += madeProgress
        }
        this.update({
          workspaceId,
          state: 'running',
          done,
          total,
          message: `Embedded ${done}/${total}…`,
        })
      }
      await this.db.documents().ensureVectorIndex()
      // ---- summary-embedding phase (DocumentSummaryIndex, ADR-0003) ----
      // Embeds already-cached summaries that have no vector yet. Pure embedder
      // work — NO LLM generation here, so it's always safe to run (the "CPU
      // generation-backfill off" decision is about generating summaries in the
      // background, which we deliberately keep on-demand). Summaries get
      // CREATED by the Library action / doc_summary route; this fills their
      // embedding for the corpus route + hierarchical prefilter.
      const summariesEmbedded = await this.backfillSummaryEmbeddings(
        workspaceId,
        embedder,
        activeIdentity,
        activeStem,
      )
      const parts: string[] = []
      if (done > 0) parts.push(`${done} chunks`)
      if (summariesEmbedded > 0) parts.push(`${summariesEmbedded} summaries`)
      this.update({
        workspaceId,
        state: 'done',
        done,
        total,
        message: parts.length > 0 ? `Backfill complete (${parts.join(', ')}).` : null,
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[backfill] aborted:', err)
      this.update({
        workspaceId,
        state: 'failed',
        done,
        total,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Embed every cached-but-unembedded document summary in the workspace.
   * Mirrors the chunk loop: purge summary vectors from an incompatible
   * embedder stem first (so a model swap re-embeds), then page through the
   * missing ones with the same runaway-loop guard. Returns the count embedded.
   * Throws on a broken embedder / dimension mismatch (caught by run()'s catch).
   */
  private async backfillSummaryEmbeddings(
    workspaceId: number,
    embedder: ReturnType<ProviderRegistry['embedder']>,
    activeIdentity: string,
    activeStem: string,
  ): Promise<number> {
    const repo = this.db.documents()
    // Same stem-compatibility purge as chunks: a genuine model swap nulls the
    // old summary vectors so the loop below refills them with the active model.
    const existing = await repo.distinctSummaryEmbedderIdentities(workspaceId)
    for (const id of existing) {
      if (embedderModelStem(id) !== activeStem) {
        await repo.purgeSummaryEmbeddingsByIdentity(workspaceId, id)
      }
    }

    let embedded = 0
    let consecutiveNoProgress = 0
    for (;;) {
      if (this.stopRequested) break
      const batch = await repo.listDocsMissingSummaryEmbedding(workspaceId, PAGE)
      if (batch.length === 0) break
      let vectors: Float32Array[] | null
      try {
        vectors = await embedder.embed(batch.map((b) => b.summary))
      } catch {
        vectors = null
      }
      let madeProgress = 0
      if (vectors) {
        for (let i = 0; i < batch.length; i++) {
          const v = vectors[i]
          const row = batch[i]
          if (!v || v.length === 0 || !row) continue
          await repo.setSummaryEmbedding(row.id, Array.from(v), activeIdentity)
          madeProgress++
        }
      }
      if (madeProgress === 0) {
        consecutiveNoProgress++
        if (consecutiveNoProgress >= 2) {
          throw new Error(
            `Embedder returned no usable vectors for ${batch.length} summaries ` +
              `(sample doc ${batch[0]?.id}). Summary backfill aborted to avoid a ` +
              `runaway loop.`,
          )
        }
      } else {
        consecutiveNoProgress = 0
        embedded += madeProgress
        this.update({
          workspaceId,
          state: 'running',
          done: embedded,
          total: embedded,
          message: `Embedded ${embedded} summaries…`,
        })
      }
    }
    return embedded
  }

  private update(s: BackfillStatus): void {
    // One tick per status push — in the embed loops update() is called once per
    // completed batch, so this advances iff embedding is actually progressing
    // (a wedged embedder is stuck in embed() and never reaches update()).
    this.progressTicks++
    this.active.set(s.workspaceId, s)
    for (const l of this.listeners) {
      try {
        l(s)
      } catch {
        /* ignore */
      }
    }
    // BrowserWindow is undefined under vitest; skip broadcast in that path
    if (typeof BrowserWindow?.getAllWindows === 'function') {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('embedder:backfillStatus', s)
        } catch {
          /* ignore */
        }
      }
    }
  }
}
