import { BrowserWindow } from 'electron'
import type { Database } from '../../db/database'
import type { ProviderRegistry } from '../providers/Registry'
import type { BackfillStatus } from '../../../shared/documents'

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

  constructor(
    private readonly db: Database,
    private readonly registry: ProviderRegistry,
  ) {}

  subscribe(cb: (s: BackfillStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
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
    // any pre-existing vectors that were produced by a *different* embedder.
    // This way a user who switches embedders (bundled ↔ ollama, or swaps the
    // ollama model) gets a clean re-embed instead of mixed-identity vectors
    // poisoning cosine search. The same backfill loop below then refills the
    // NULLs we just punched.
    const activeIdentity = embedder.identity()
    const purged = await this.db.documents().purgeEmbeddingsNotMatching(workspaceId, activeIdentity)
    if (purged > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[backfill] purged ${purged} stale chunks (identity != ${activeIdentity})`)
    }

    const total = await this.db.documents().countChunksMissingEmbedding(workspaceId)
    if (total === 0) {
      this.update({ workspaceId, state: 'done', done: 0, total: 0, message: null })
      return
    }
    this.update({
      workspaceId,
      state: 'running',
      done: 0,
      total,
      message: `Embedding ${total} pending chunks…`,
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
        const batch = await this.db.documents().listChunksMissingEmbedding(workspaceId, PAGE)
        if (batch.length === 0) break
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
          for (let i = 0; i < batch.length; i++) {
            const v = vectors[i]
            const row = batch[i]
            if (!v || !row) continue
            try {
              await this.db.documents().setChunkEmbedding(row.id, Array.from(v), activeIdentity)
              madeProgress++
            } catch (err) {
              // Most likely a pgvector dimension mismatch (the model was
              // swapped after the column type was set). Surface it once and
              // bail — re-trying every batch would just spam logs.
              throw new Error(
                `Failed to write embedding for chunk ${row.id}: ${
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
      this.update({
        workspaceId,
        state: 'done',
        done,
        total,
        message: `Backfill complete (${done} chunks).`,
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

  private update(s: BackfillStatus): void {
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
