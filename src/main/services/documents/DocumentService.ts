import { basename, extname } from 'node:path'
import { statSync, type Stats } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { AuthService } from '../auth/AuthService'
// ADR-0005: documents now come from the per-workspace encrypted SQLite store;
// WsDocument is the camelCase row the facade returns (drop-in for the old
// PGlite `Document` the renderer + services consume).
import type { WsDocument as Document } from '../../db/sqlite/WorkspaceDb'
import type { ProviderRegistry } from '../providers/Registry'
import type { DocumentsWorkerClient } from '../workers/DocumentsWorkerClient'
import { ImportError, type IndexProgress } from './types'
import { isSupported, parseFile } from './parser'
import {
  chunkPages,
  chunkMarkdown,
  tagChunksWithSections,
  tagChunkLanguages,
  type Chunk,
} from './chunker'
import { resolveChunkOptions } from './chunkOptions'
import { documentEmbeddingInput } from './searchContext'
import { fileTrack } from '../codebase/ignore'
import { chunkCode, type CodeChunkOptions } from '../codebase/codeChunker'
import { indexingBatchSize } from '../embeddings/indexingBatch'
import type { WorkspaceDbFacade } from '../storage/WorkspaceDbFacade'
import { validateEmbeddingBatch } from '../embeddings/validateBatch'
import { parseMarkdownSections } from './markdownParser'
import {
  GENERATED_DOCUMENT_SOURCE_PREFIX,
  isGeneratedDocumentSource,
} from '../../../shared/documentSource'

type DocumentsRepo = Awaited<ReturnType<WorkspaceDbFacade['documentsFor']>>

const MAX_IMPORT_BYTES = 50 * 1024 * 1024 // max. Import-Größe

class IndexingCancelledError extends Error {
  constructor() {
    super('Indexing cancelled.')
  }
}

type ProgressSender = WebContents | { send: (channel: string, payload: IndexProgress) => void }

export interface ImportInput {
  workspaceId: number
  sourcePath: string
  sender?: ProgressSender
  chunkSize?: number
  chunkOverlap?: number
}

export interface GeneratedTextImportInput {
  workspaceId: number
  title: string
  text: string
  mimeType: 'text/plain' | 'text/markdown'
  sender?: ProgressSender
}

type IndexJobKind = 'import' | 'reindex' | 'generated'

export class DocumentService {
  private readonly database: WorkspaceDbFacade
  private invalidated = false

  constructor(
    private readonly auth: AuthService,
    private readonly registry?: ProviderRegistry,
    /** Optional worker client. When present, parseFile + OCR + chunker run in
     *  the dedicated documentsWorker utilityProcess so a book-length or scanned
     *  PDF doesn't pin the main event loop (and never competes with chat-token
     *  streaming on the models worker). Tests construct DocumentService without
     *  one and the inline path is used as a fallback. */
    private readonly worker?: DocumentsWorkerClient,
    /** AP-9 §3.8: supplies the user's configured chunk size/overlap so every
     *  ingest path (import, reindex, refresh, folder-sync) chunks per the
     *  indexing settings. Optional — tests omit it and the chunker DEFAULT
     *  applies. An explicit ImportInput value still wins. */
    private readonly retrievalDefaults?: () => { chunkSize: number; chunkOverlap: number },
    /** ADR-0005: writes freshly-computed embeddings into the per-workspace
     *  encrypted LanceDB store (where retrieval reads them). When present,
     *  vectors go to Lance only and PGlite records just the `embedded` marker;
     *  tests omit it and the legacy pgvector column is written instead. */
    private readonly vectorSink?: (
      workspaceId: number,
      records: Array<{ chunkId: number; documentId: number; vector: number[] }>,
    ) => Promise<void>,
    /** ADR-0005: drops retired chunk vectors before replacement indexing
     *  (chunks are recreated with new IDs). Optional — tests omit it. */
    private readonly vectorRemove?: (workspaceId: number, chunkIds: number[]) => Promise<void>,
  ) {
    this.database = auth.requireDatabase()
  }

  /** Permanent session boundary. Native work may finish later, but it cannot
   * publish progress, acquire more work, or write into a subsequent login. */
  invalidateSession(): void {
    this.invalidated = true
    this.quiescing = true
    this.indexQueue.length = 0
    for (const job of this.activeJobs.values()) job.cancelled = true
  }

  /** Call after invalidateSession(), before closing the captured workspace
   *  store. A mutation that already retired SQLite rows still owes its queued
   *  vector cleanup; no new destructive work can pass the session guard. */
  async drainMutations(): Promise<void> {
    await Promise.all([...this.documentOperations.values()])
  }

  private assertSession(): void {
    if (this.invalidated) throw new Error('Document session is closed.')
  }

  // ---- bounded indexing queue --------------------------------------------
  //
  // importFile / refresh / reindex used to fire indexInBackground detached, so
  // dropping a folder of N files spun up N concurrent parse+OCR+embed pipelines
  // at once — unbounded memory and worker-queue flooding (much worse now that
  // OCR makes each job multi-second). We cap in-flight jobs instead. Two is the
  // sweet spot: parse+OCR runs in the documentsWorker while embed runs in the
  // modelsWorker, so two jobs pipeline across the two processes without either
  // worker's event loop thrashing.
  private static readonly MAX_CONCURRENT_INDEXING = 2
  private activeIndexing = 0
  private activeJobs = new Map<
    string,
    {
      workspaceId: number
      kind: IndexJobKind
      cancelled: boolean
      completion: Promise<void>
    }
  >()
  private readonly documentOperations = new Map<string, Promise<void>>()
  // Set by quiesce() (app-quit drain). Once true the pump stops starting new
  // jobs so the active ones can settle before the workspace store is closed.
  private quiescing = false
  // Monotonic count of indexing progress events (phase changes, OCR ticks, and
  // per-batch embeds). The app-quit drain watches this to tell "still working"
  // apart from "wedged" so it can wait adaptively — see drainIndexingForQuit
  // in main/index.ts.
  private progressTicks = 0
  private readonly indexQueue: Array<{
    doc: Document
    input: ImportInput
    /** 'import' rows are placeholders with no chunks yet — cancellation may
     *  delete them. 'reindex' rows are real docs (chunks already wiped by
     *  reindex_document); cancellation marks them failed instead of deleting. */
    kind: IndexJobKind
  }> = []

  private enqueueIndexing(doc: Document, input: ImportInput, kind: IndexJobKind): void {
    this.assertSession()
    this.indexQueue.push({ doc, input, kind })
    this.pumpIndexQueue()
  }

  /** True while any document is running through the pipeline or still queued.
   *  Consulted by the vault's inactivity auto-lock guard so a long unattended
   *  import/reindex isn't torn down mid-embed by the 15 min idle lock (which
   *  would close the workspace store and abort the in-flight batch). */
  isIndexing(): boolean {
    return this.activeIndexing > 0 || this.indexQueue.length > 0
  }

  /** True while at least one document is being processed in a worker right now
   *  (as opposed to merely queued). The app-quit drain waits on this so the
   *  active batch's writes land before the workspace store is re-encrypted. */
  hasActiveIndexing(): boolean {
    return this.activeIndexing > 0
  }

  /** Monotonic progress counter (see `progressTicks`). The app-quit drain polls
   *  it to wait adaptively while indexing advances and give up only on a stall. */
  indexProgressTicks(): number {
    return this.progressTicks
  }

  /** Stop starting *new* indexing jobs and drop everything still queued.
   *  In-flight jobs already handed to the workers are left to finish — their
   *  parse/embed requests aren't abortable mid-flight. Used by the app-quit
   *  drain so the pump doesn't keep refilling slots while we wait for the
   *  active jobs to settle. Permanent: the process is on its way down. */
  quiesce(): void {
    this.quiescing = true
    this.indexQueue.length = 0
  }

  private pumpIndexQueue(): void {
    // Backstop for lock paths that cannot drain first (the idle auto-lock
    // fires inside AuthService): once the vault is locked the manifest and
    // meta.db are gone, so every dispatch would just throw "workspace not
    // found" — one stack-trace cascade per queued job, pumped two at a time by
    // the finally below. Drop the queue instead; the rows stay 'pending' and
    // sweepOrphanedIndexing reconciles them on the next unlock, exactly like a
    // crashed session.
    if (this.invalidated || !this.auth.isUnlocked()) {
      this.indexQueue.length = 0
      return
    }
    while (
      !this.quiescing &&
      this.activeIndexing < DocumentService.MAX_CONCURRENT_INDEXING &&
      this.indexQueue.length > 0
    ) {
      const job = this.indexQueue.shift()!
      this.activeIndexing += 1
      const jobKey = `${job.doc.workspaceId}:${job.doc.id}`
      const activeJob = {
        workspaceId: job.input.workspaceId,
        kind: job.kind,
        cancelled: false,
        completion: Promise.resolve(),
      }
      this.activeJobs.set(jobKey, activeJob)
      activeJob.completion = this.indexInBackground(job.doc, job.input)
        .catch(() => {
          // errors are surfaced via the IPC progress 'failed' event and the
          // doc row's status; indexInBackground never rejects with anything we
          // need to act on here.
        })
        .finally(() => {
          this.activeIndexing -= 1
          if (this.activeJobs.get(jobKey) === activeJob) this.activeJobs.delete(jobKey)
          this.pumpIndexQueue()
        })
    }
  }

  /** Serialize changes to a workspace-local document. Background native work
   *  is drained separately before replacing/deleting the rows it can write. */
  private async withDocumentLock<T>(doc: Document, operation: () => Promise<T>): Promise<T> {
    const key = `${doc.workspaceId}:${doc.id}`
    const previous = this.documentOperations.get(key)
    const result = (async () => {
      await previous
      this.assertSession()
      return operation()
    })()
    const settled = result.then(
      () => {},
      () => {},
    )
    this.documentOperations.set(key, settled)
    try {
      return await result
    } finally {
      if (this.documentOperations.get(key) === settled) this.documentOperations.delete(key)
    }
  }

  private async withDocument<T>(
    documentId: number,
    operation: (doc: Document, repo: DocumentsRepo) => Promise<T>,
    workspaceId?: number,
  ): Promise<T> {
    this.assertSession()
    // Resolve the active document once, before any file/model work; all later
    // operations stay in its original workspace even if the UI navigates away.
    const initialRepo =
      workspaceId === undefined
        ? this.database.documents()
        : await this.database.documentsFor(workspaceId)
    const initial = await initialRepo.getDocument(documentId)
    this.assertSession()
    if (!initial) throw new Error(`Document ${documentId} not found`)
    return this.withDocumentLock(initial, async () => {
      const repo = await this.database.documentsFor(initial.workspaceId)
      this.assertSession()
      const doc = await repo.getDocument(documentId)
      this.assertSession()
      if (!doc) throw new Error(`Document ${documentId} not found`)
      return operation(doc, repo)
    })
  }

  private async stopDocumentIndexing(doc: Document): Promise<void> {
    for (let i = this.indexQueue.length - 1; i >= 0; i--) {
      const queued = this.indexQueue[i]!
      if (queued.doc.workspaceId === doc.workspaceId && queued.doc.id === doc.id)
        this.indexQueue.splice(i, 1)
    }
    const active = this.activeJobs.get(`${doc.workspaceId}:${doc.id}`)
    if (!active) return
    // The row is about to be reused or explicitly deleted by the caller.
    // Canceling an unfinished import must not delete it behind that caller.
    active.kind = 'reindex'
    active.cancelled = true
    await active.completion
  }

  /** Stop queued jobs and active jobs at the next parse/embedding boundary. */
  async cancelWorkspaceIndexing(workspaceId: number): Promise<number> {
    if (this.invalidated) return 0
    let active = 0
    for (const job of this.activeJobs.values()) {
      if (job.workspaceId === workspaceId && !job.cancelled) {
        job.cancelled = true
        active++
      }
    }
    const cancelled: typeof this.indexQueue = []
    for (let i = this.indexQueue.length - 1; i >= 0; i--) {
      if (this.indexQueue[i]!.input.workspaceId === workspaceId) {
        cancelled.push(this.indexQueue.splice(i, 1)[0]!)
      }
    }
    return active + (await this.reconcileCancelledJobs(cancelled))
  }

  /** Drop every not-yet-started indexing job across all workspaces and
   *  reconcile their rows while the vault DB is still open. Called by the
   *  explicit lock/logout drain before AuthService closes the workspace store —
   *  without it, lock() clears the manifest under a full queue and the pump
   *  cascades one "workspace not found" failure per queued document. This is
   *  resumable within the current session; invalidateSession permanently
   *  retires this instance at lock. In-flight jobs are left to finish unless
   *  includeActive is set. */
  async cancelAllIndexing(includeActive = false): Promise<number> {
    if (this.invalidated) return 0
    let active = 0
    if (includeActive)
      for (const job of this.activeJobs.values()) {
        if (!job.cancelled) {
          job.cancelled = true
          active++
        }
      }
    return (
      active +
      (await this.reconcileCancelledJobs(this.indexQueue.splice(0, this.indexQueue.length)))
    )
  }

  /** Import placeholders (no chunks yet) are deleted outright; reindex jobs
   *  (real docs whose chunks were already wiped) are marked 'failed' so the
   *  user can retry. */
  private async reconcileCancelledJobs(cancelled: typeof this.indexQueue): Promise<number> {
    if (cancelled.length === 0) return 0
    for (const job of cancelled) {
      if (this.invalidated) break
      try {
        const repo = await this.database.documentsFor(job.doc.workspaceId)
        this.assertSession()
        if (job.kind === 'import') await repo.deleteDocument(job.doc.id)
        else await repo.setDocumentStatus(job.doc.id, 'failed')
      } catch {
        // row may already be gone (concurrent delete) — nothing to do
      }
    }
    return cancelled.length
  }

  /** Reset documents left mid-index by a previous crashed session. Call once at
   *  login, before any new import is enqueued. Returns the number reset. */
  async sweepOrphanedIndexing(): Promise<number> {
    this.assertSession()
    return this.database.documents().resetStuckIndexing()
  }

  async importFile(input: ImportInput): Promise<Document> {
    this.assertSession()
    const { stat, hash } = await this.statAndHashOrThrow(input.sourcePath)
    this.assertSession()
    const mime = mimeFromExt(extname(input.sourcePath))
    const repo = await this.database.documentsFor(input.workspaceId)
    this.assertSession()
    // Guard the unique (workspace_id, source_path) index in JS so callers get a
    // coded ImportError instead of a raw SQL stack. Pre-fix, the bug surfaced
    // as `documents:reindex` doing reindex_document + importFile back-to-back ,
    // any future caller that loops sync+import or otherwise re-imports an
    // already-vectorized path would have hit the same opaque trace. Reindex is
    // the right verb for this case ; this layer just refuses to be the one
    // that masks it.
    const existing = await repo.findByWorkspaceAndPath(input.workspaceId, input.sourcePath)
    this.assertSession()
    if (existing) {
      throw new ImportError(
        `${basename(input.sourcePath)} ist bereits in dieser Bibliothek — Reindex statt erneuter Import.`,
        'already_imported',
        input.sourcePath,
      )
    }
    const doc = await repo.addDocument({
      workspaceId: input.workspaceId,
      title: basename(input.sourcePath),
      sourcePath: input.sourcePath,
      mimeType: mime ?? null,
      byteSize: stat.size,
      contentHash: hash,
      sourceMtime: Math.round(stat.mtimeMs),
    })
    this.enqueueIndexing(doc, input, 'import')
    return doc
  }

  /** Persist generated source atomically with its document before queueing any
   * model work. Stop, lock, quit, or an indexing error cannot lose the only
   * source copy, and no plaintext staging file needs cleanup. */
  async importGeneratedText(input: GeneratedTextImportInput): Promise<Document> {
    this.assertSession()
    const sourcePath = `${GENERATED_DOCUMENT_SOURCE_PREFIX}${randomUUID()}.${input.mimeType === 'text/markdown' ? 'md' : 'txt'}`
    if (input.mimeType !== 'text/plain' && input.mimeType !== 'text/markdown')
      throw new ImportError('Unsupported generated document type.', 'unsupported', sourcePath)
    if (typeof input.text !== 'string' || !input.text.trim())
      throw new ImportError('The generated document is empty.', 'unreadable', sourcePath)
    if (typeof input.title !== 'string' || !input.title.trim())
      throw new ImportError('A generated document needs a title.', 'unreadable', sourcePath)
    const bytes = Buffer.byteLength(input.text, 'utf8')
    if (bytes > MAX_IMPORT_BYTES)
      throw new ImportError(
        'Generated text exceeds the 50 MB import limit.',
        'too_large',
        sourcePath,
      )
    const repo = await this.database.documentsFor(input.workspaceId)
    this.assertSession()
    const doc = await repo.addDocument({
      workspaceId: input.workspaceId,
      title: input.title.trim(),
      sourcePath,
      mimeType: input.mimeType,
      byteSize: bytes,
      contentHash: createHash('sha256').update(input.text, 'utf8').digest('hex'),
      generatedText: input.text,
    })
    this.enqueueIndexing(
      doc,
      {
        workspaceId: input.workspaceId,
        sourcePath,
        ...(input.sender ? { sender: input.sender } : {}),
      },
      'generated',
    )
    return doc
  }

  /** Repoints an existing document at a new path on disk and reindexes from
   *  scratch. Title is refreshed too (the user likely picked a renamed copy).
   *  Returns the updated doc row pre-index ; chunks repopulate via the
   *  background pipeline and the renderer follows progress via the existing
   *  indexing:progress channel. */
  async replaceSource(
    documentId: number,
    newPath: string,
    sender?: ProgressSender,
    workspaceId?: number,
  ): Promise<Document> {
    return this.withDocument(
      documentId,
      async (original, repo) => {
        const { stat, hash } = await this.statAndHashOrThrow(newPath)
        this.assertSession()
        const existing = await repo.findByWorkspaceAndPath(original.workspaceId, newPath)
        this.assertSession()
        if (existing && existing.id !== documentId)
          throw new ImportError('This file is already in the library.', 'already_imported', newPath)
        await this.stopDocumentIndexing(original)
        this.assertSession()
        await this.resetDocumentChunks(original, repo)
        this.assertSession()
        await repo.setSourceMetadata(documentId, {
          sourcePath: newPath,
          title: basename(newPath),
          mimeType: mimeFromExt(extname(newPath)) ?? null,
          byteSize: stat.size,
          contentHash: hash,
          sourceMtime: Math.round(stat.mtimeMs),
          generatedText: null,
        })
        // Replacing the source always satisfies any prior "file missing" banner
        // for this doc id — clear both the marker and the dismissal so a future
        // disappearance gets re-notified.
        await repo.clearMissing(documentId)
        const doc = (await repo.getDocument(documentId))!
        const indexInput: ImportInput = { workspaceId: doc.workspaceId, sourcePath: newPath }
        if (sender) indexInput.sender = sender
        this.enqueueIndexing(doc, indexInput, 'reindex')
        return doc
      },
      workspaceId,
    )
  }

  /** Cheap "did the file change since we indexed it" probe used by both the
   *  per-doc Refresh action and FolderSyncService. Returns:
   *    'unchanged' — mtime + hash still match what we stored
   *    'reindexed' — file changed, a background reindex was kicked off
   *    'missing'   — source path is gone (we leave the doc alone; UI surfaces)
   *  mtime is the fast path ; we only hash when mtime differs so a folder full
   *  of untouched PDFs doesn't slurp megabytes per sync tick. */
  async refreshDocument(
    documentId: number,
    sender?: ProgressSender,
    workspaceId?: number,
  ): Promise<'unchanged' | 'reindexed' | 'missing'> {
    return this.withDocument(
      documentId,
      async (doc, repo) => {
        if (isGeneratedDocumentSource(doc.sourcePath)) return 'unchanged'
        let stat: Stats
        try {
          stat = statSync(doc.sourcePath)
        } catch {
          // Stamp the soft-missing marker so the LibraryView banner picks this
          // doc up. Idempotent at the repo level — repeated probes won't bump
          // the timestamp once it's set.
          await repo.markMissing(documentId)
          return 'missing'
        }
        // File reachable — if a prior probe marked it missing, lift that marker
        // so the banner drops it.
        if (doc.missingAt != null) {
          await repo.clearMissing(documentId)
        }
        const mtime = Math.round(stat.mtimeMs)
        // Copy/sync tools can preserve timestamps while replacing the content.
        // A changed length must still reach the hash/size checks below.
        if (
          doc.sourceMtime != null &&
          doc.sourceMtime === mtime &&
          doc.byteSize === stat.size &&
          doc.contentHash != null
        ) {
          return 'unchanged'
        }
        // mtime differs (or we never recorded one) — confirm with the hash before
        // paying the reindex cost. Some editors rewrite-then-restore mtime, and
        // some sync tools touch mtime without changing bytes.
        if (stat.size > MAX_IMPORT_BYTES) {
          throw new ImportError(
            `${basename(doc.sourcePath)} is ${(stat.size / 1024 / 1024).toFixed(1)} MB, exceeds the 50 MB import limit.`,
            'too_large',
            doc.sourcePath,
          )
        }
        const hash = await sha256OfFile(doc.sourcePath)
        this.assertSession()
        if (doc.contentHash === hash) {
          // touch-only — refresh mtime so the next probe short-circuits.
          await repo.setSourceMetadata(documentId, { sourceMtime: mtime })
          return 'unchanged'
        }
        await this.stopDocumentIndexing(doc)
        this.assertSession()
        await this.resetDocumentChunks(doc, repo)
        this.assertSession()
        await repo.setSourceMetadata(documentId, {
          byteSize: stat.size,
          contentHash: hash,
          sourceMtime: mtime,
        })
        const refreshed = (await repo.getDocument(documentId))!
        const indexInput: ImportInput = {
          workspaceId: refreshed.workspaceId,
          sourcePath: refreshed.sourcePath,
        }
        if (sender) indexInput.sender = sender
        this.enqueueIndexing(refreshed, indexInput, 'reindex')
        return 'reindexed'
      },
      workspaceId,
    )
  }

  /** User-triggered "Reindex" button. Unconditionally wipes chunks + re-parses
   *  the existing source path against the existing doc row , no insert , no
   *  hash short-circuit. ImportError surfaces if the file vanished or is
   *  oversized so the renderer can show the same toast as the import flow. */
  async reindex(documentId: number, sender?: ProgressSender): Promise<Document> {
    return this.withDocument(documentId, async (doc, repo) => {
      const generated = isGeneratedDocumentSource(doc.sourcePath)
      const source = generated ? await repo.getGeneratedText(documentId) : null
      if (generated && source == null)
        throw new ImportError(
          'The stored generated source is unavailable.',
          'unreadable',
          doc.sourcePath,
        )
      const file = generated ? null : await this.statAndHashOrThrow(doc.sourcePath)
      this.assertSession()
      await this.stopDocumentIndexing(doc)
      this.assertSession()
      await this.resetDocumentChunks(doc, repo)
      this.assertSession()
      if (file)
        await repo.setSourceMetadata(documentId, {
          byteSize: file.stat.size,
          contentHash: file.hash,
          sourceMtime: Math.round(file.stat.mtimeMs),
        })
      if (doc.missingAt != null) {
        await repo.clearMissing(documentId)
      }
      const refreshed = (await repo.getDocument(documentId))!
      const indexInput: ImportInput = {
        workspaceId: refreshed.workspaceId,
        sourcePath: refreshed.sourcePath,
      }
      if (sender) indexInput.sender = sender
      this.enqueueIndexing(refreshed, indexInput, 'reindex')
      return refreshed
    })
  }

  /** Retires documents (rows cascade to chunks + FTS), then drops their vectors.
   *  This order prevents an in-flight backfill from restoring deleted vectors:
   *  the vector service rejects retired IDs, and its FIFO purge follows any
   *  already admitted write. Purges are best effort on storage failure; a
   *  failed purge is logged and can leave derived vectors without source rows.
   *  Chunk IDs are batched per workspace to avoid per-document compaction. */
  async deleteDocuments(documentIds: number[], workspaceId?: number): Promise<void> {
    this.assertSession()
    const activeRepo =
      workspaceId === undefined
        ? this.database.documents()
        : await this.database.documentsFor(workspaceId)
    // Resolve all ids before yielding so a workspace switch cannot mix stores.
    const documents = (
      await Promise.all([...new Set(documentIds)].map((id) => activeRepo.getDocument(id)))
    )
      .filter((doc): doc is Document => doc != null)
      .sort((a, b) => a.workspaceId - b.workspaceId || a.id - b.id)
    const withLocks = (index: number): Promise<void> => {
      const doc = documents[index]
      return doc ? this.withDocumentLock(doc, () => withLocks(index + 1)) : remove()
    }
    const remove = async (): Promise<void> => {
      const repos = new Map<number, DocumentsRepo>()
      for (const doc of documents) {
        await this.stopDocumentIndexing(doc)
        this.assertSession()
        if (!repos.has(doc.workspaceId))
          repos.set(doc.workspaceId, await this.database.documentsFor(doc.workspaceId))
      }
      const chunksByDocument = new Map<Document, number[]>()
      for (const doc of documents) {
        const chunkIds = await repos.get(doc.workspaceId)!.chunkIdsForDocument(doc.id)
        chunksByDocument.set(doc, chunkIds)
      }
      const retiredByWorkspace = new Map<number, number[]>()
      try {
        for (const doc of documents) {
          this.assertSession()
          await repos.get(doc.workspaceId)!.deleteDocument(doc.id)
          const chunkIds = chunksByDocument.get(doc)!
          if (chunkIds.length > 0) {
            const list = retiredByWorkspace.get(doc.workspaceId)
            if (list) list.push(...chunkIds)
            else retiredByWorkspace.set(doc.workspaceId, chunkIds)
          }
        }
      } finally {
        // If a later SQLite delete fails, still purge the earlier successful
        // deletions without touching vectors belonging to retained documents.
        if (this.vectorRemove) {
          for (const [workspaceId, chunkIds] of retiredByWorkspace) {
            try {
              await this.vectorRemove(workspaceId, chunkIds)
            } catch (err) {
              console.warn(`[documents] vector remove failed for workspace #${workspaceId}:`, err)
            }
          }
        }
      }
    }
    await withLocks(0)
    this.assertSession()
  }

  /** Capture IDs before retiring rows, then queue the native purge before any
   *  replacement indexing. The vector FIFO + live-owner check also excludes
   *  late backfill results. A storage purge failure remains best effort. */
  private async resetDocumentChunks(doc: Document, repo: DocumentsRepo): Promise<void> {
    const ids = this.vectorRemove ? await repo.chunkIdsForDocument(doc.id) : []
    this.assertSession()
    await repo.reindexDocument(doc.id)
    // Once rows have been retired, finish their captured-session cleanup even
    // if lock invalidates this service. Session shutdown drains this mutation
    // before closing the store; callers still guard replacement indexing.
    if (!this.vectorRemove || ids.length === 0) return
    try {
      await this.vectorRemove(doc.workspaceId, ids)
    } catch (err) {
      console.warn(`[documents] vector remove failed for doc #${doc.id}:`, err)
    }
  }

  /** Shared file-validation path used by importFile + replaceSource. Returns
   *  stat + hash in one read so callers don't double-stream the file. */
  private async statAndHashOrThrow(sourcePath: string): Promise<{ stat: Stats; hash: string }> {
    if (!isSupported(sourcePath)) {
      throw new ImportError(
        `Unsupported file type: ${basename(sourcePath)}`,
        'unsupported',
        sourcePath,
      )
    }
    let stat: Stats
    try {
      stat = statSync(sourcePath)
    } catch (err) {
      throw new ImportError(
        `Cannot read ${basename(sourcePath)}: ${err instanceof Error ? err.message : String(err)}`,
        'unreadable',
        sourcePath,
      )
    }
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new ImportError(
        `${basename(sourcePath)} is ${(stat.size / 1024 / 1024).toFixed(1)} MB, exceeds the 50 MB import limit.`,
        'too_large',
        sourcePath,
      )
    }
    const hash = await sha256OfFile(sourcePath)
    return { stat, hash }
  }

  /**
   * Repo-relative path for a code chunk's breadcrumb (heading_path[0]).
   * fileRole's directory predicates (tests/, evals/, fixtures/, …) and any
   * path-carrying retrieval signal only work on a PATH — passing just the
   * basename silently classified tests/evals files as 'source' at retrieval
   * time and threw the directory context away (R6). Longest-prefix match
   * against the workspace's sync roots; a file no root contains (single-file
   * import) keeps the basename, exactly the legacy shape.
   */
  private async resolveCodeRelPath(doc: Document): Promise<string> {
    try {
      const roots = await this.database.workspaces().getSyncFolders(doc.workspaceId)
      const norm = (p: string): string => p.replace(/\\/g, '/')
      const src = norm(doc.sourcePath)
      const srcLower = src.toLowerCase()
      let bestLen = 0
      for (const root of roots) {
        let r = norm(root)
        if (!r.endsWith('/')) r += '/'
        // Case-insensitive prefix match (Windows paths vary in drive/dir case);
        // slice from the original string — norm() preserves length.
        if (srcLower.startsWith(r.toLowerCase()) && r.length > bestLen) bestLen = r.length
      }
      if (bestLen > 0) return src.slice(bestLen)
    } catch {
      // vault locked / no workspaces facade (unit tests) — basename fallback.
    }
    return basename(doc.sourcePath)
  }

  private async indexInBackground(doc: Document, input: ImportInput): Promise<void> {
    let indexingLease: import('../../../shared/modelActivity').IndexingLease | undefined
    const jobKey = `${doc.workspaceId}:${doc.id}`
    const TOTAL = 4
    const sender = input.sender
    const send = (
      phase: IndexProgress['phase'],
      step: number,
      error?: string,
      detail?: string,
      chunksPerSec?: number,
      chunksDone?: number,
      chunksTotal?: number,
    ): void => {
      if (this.invalidated) return
      // Tick before the sender guard: the quit drain's liveness signal must
      // advance even in contexts with no renderer attached (folder-sync).
      this.progressTicks++
      if (chunksDone !== undefined && chunksTotal !== undefined)
        indexingLease?.update(chunksDone, chunksTotal)
      if (!sender) return
      try {
        const payload: IndexProgress = {
          workspaceId: doc.workspaceId,
          documentId: doc.id,
          title: doc.title,
          phase,
          step,
          total: TOTAL,
        }
        if (error !== undefined) payload.error = error
        if (detail !== undefined) payload.detail = detail
        if (chunksPerSec !== undefined) payload.chunksPerSec = chunksPerSec
        if (chunksDone !== undefined) payload.chunksDone = chunksDone
        if (chunksTotal !== undefined) payload.chunksTotal = chunksTotal
        sender.send('indexing:progress', payload)
      } catch {
        // renderer gone
      }
    }
    const checkCancelled = (): void => {
      this.assertSession()
      if (this.activeJobs.get(jobKey)?.cancelled) throw new IndexingCancelledError()
    }
    // requireDatabase() used to live outside this try, which meant a lock or
    // logout firing between addDocument and the first await would throw past
    // indexInBackground entirely, leave the row stuck at 'pending', and the
    // outer .catch(() => {}) in importFile would silently eat it. Moving it
    // inside guarantees the catch arm at the bottom flips status='failed' so
    // the row reflects what actually happened.
    try {
      checkCancelled()
      // Pin to the document's OWN workspace, not the active one. Folder-sync
      // indexes documents across every workspace at login regardless of which is
      // on screen; routing persistChunks/setDocumentStatus through active() lands
      // them in the wrong store and trips the FK (chunks.document_id → documents).
      const repo = await this.database.documentsFor(doc.workspaceId)
      checkCancelled()
      await repo.setDocumentStatus(doc.id, 'indexing')
      checkCancelled()
      send('parsing', 1)

      // Markdown gets section-aware chunking so citations can render breadcrumbs
      // ("§ Introduction › Why MD") rather than the meaningless "p. 1" we'd
      // otherwise emit for a single-page markdown ParsedDocument. PDFs use
      // page-based chunking, then we overlay the bookmark outline (when the
      // author shipped one) so citations get both "§ Chapter 2" AND "p. 14".
      // The worker path runs both parse + chunk off the main event loop so
      // the renderer stays responsive even on book-length PDFs ; the inline
      // path is the fallback for tests/contexts without a worker.
      // AP-9 §3.8: chunk size/overlap come from the indexing settings (an
      // explicit ImportInput value still wins). Every ingest path funnels
      // through here, so all of them honour the sliders.
      const effChunk = resolveChunkOptions(input, this.retrievalDefaults?.())
      let out: Chunk[]
      if (isGeneratedDocumentSource(doc.sourcePath)) {
        const source = await repo.getGeneratedText(doc.id)
        if (source == null)
          throw new ImportError(
            'The stored generated source is unavailable.',
            'unreadable',
            doc.sourcePath,
          )
        checkCancelled()
        send('chunking', 2)
        const chunkOpts = {
          ...(effChunk.chunkSize !== undefined ? { maxChars: effChunk.chunkSize } : {}),
          ...(effChunk.chunkOverlap !== undefined ? { overlap: effChunk.chunkOverlap } : {}),
        }
        out =
          doc.mimeType === 'text/markdown'
            ? chunkMarkdown(parseMarkdownSections(source), chunkOpts)
            : chunkPages([{ num: 1, text: source }], chunkOpts)
        out = await tagChunkLanguages(out)
      } else if (fileTrack(doc.sourcePath) === 'code') {
        // ADR-0006 code track: structure-aware chunking (line ranges in
        // pageFrom/pageTo). Bypasses the PDF/markdown parser + worker entirely —
        // a source file is just UTF-8 text. Language tagging is skipped (eld's
        // de/en/other classes are meaningless for code; left null).
        send('parsing', 1)
        const source = await readFile(doc.sourcePath, 'utf8')
        send('chunking', 2)
        const codeOpts: CodeChunkOptions = { relPath: await this.resolveCodeRelPath(doc) }
        if (effChunk.chunkSize !== undefined) codeOpts.maxChars = effChunk.chunkSize
        out = chunkCode(source, codeOpts)
      } else if (this.worker) {
        const chunkPayload: {
          sourcePath: string
          documentId: number
          chunkSize?: number
          chunkOverlap?: number
        } = {
          sourcePath: doc.sourcePath,
          documentId: doc.id,
        }
        if (effChunk.chunkSize !== undefined) chunkPayload.chunkSize = effChunk.chunkSize
        if (effChunk.chunkOverlap !== undefined) chunkPayload.chunkOverlap = effChunk.chunkOverlap
        // Surface scanned-page OCR progress under the parsing phase so a slow
        // OCR pass reads as progress, not a hang. The worker client routes this
        // callback by request ID, including overlapping workspace-local doc IDs.
        const { chunks: workerChunks } = await this.worker.parseAndChunk(
          chunkPayload,
          (done, total) => send('parsing', 1, undefined, `OCR ${done}/${total}`),
        )
        out = workerChunks
        send('chunking', 2)
      } else {
        const parsed = await parseFile(doc.sourcePath, {
          onOcrProgress: (done, total) => send('parsing', 1, undefined, `OCR ${done}/${total}`),
        })
        send('chunking', 2)
        const chunkOpts: Parameters<typeof chunkPages>[1] = {}
        if (effChunk.chunkSize !== undefined) chunkOpts.maxChars = effChunk.chunkSize
        if (effChunk.chunkOverlap !== undefined) chunkOpts.overlap = effChunk.chunkOverlap
        if (parsed.kind === 'markdown') {
          out = chunkMarkdown(parsed.sections, chunkOpts)
        } else if (parsed.kind === 'pdf' && parsed.sections.length > 0) {
          out = tagChunksWithSections(chunkPages(parsed.pages, chunkOpts), parsed.sections)
        } else {
          out = chunkPages(parsed.pages, chunkOpts)
        }
        // Mirror the worker path's language tagging so unit tests + degraded
        // (no-worker) ingest still populate chunks.language and the prompt
        // formatter gets the cross-language hint either way.
        out = await tagChunkLanguages(out)
      }

      // Embed first, persist second. Order matters: we need the chunk text
      // available for embed() before the DB row exists, so we batch the
      // forward pass over `out` then map vectors back to inserted rows by
      // ordinal. The registry is optional — DocumentService is constructed
      // without one in unit tests + the auth-flow integration paths, so the
      // embedding phase silently degrades to a no-op (Spec 1 behaviour).
      //
      // The provider contract throws on failure (no embedder model on disk,
      // Ollama unreachable, per-passage embed error). We page the forward pass
      // in provider-sized batches (one on CPU, four on a bundled GPU)
      // rather than embedding every chunk in one call: a book-length or OCR'd
      // PDF can be hundreds of passages, and a single embed() over all of them
      // is both a memory/timeout spike AND all-or-nothing — one bad passage
      // throws for the whole batch and NULLs the entire document's vectors.
      // Batching isolates a failure to its own page; the rest persist embedded
      // and only the failed page defers to the backfill service.
      checkCancelled()
      send('embedding', 3, undefined, `embedding 0/${out.length}`, undefined, 0, out.length)
      let vectors: Array<Float32Array | null> | null = null
      let activeIdentity: string | null = null
      if (this.registry && out.length > 0) {
        const embedder = this.registry.embedder()
        // Parsing, OCR and chunking use the documents worker, not the model
        // GPU. Reserve it only once real embedding work exists so a slow or
        // failed parse cannot park chat or warm an unused embedding model.
        // Keep this lease through every batch and its related persistence.
        checkCancelled()
        indexingLease = await embedder.beginIndexing?.({
          workspaceId: doc.workspaceId,
          title: doc.title,
        })
        checkCancelled()
        indexingLease?.update(0, out.length)
        checkCancelled()
        await embedder.ensureReady()
        checkCancelled()
        if (embedder.isReady()) {
          // R3: code chunks carry their file/symbol identity in contextPrefix —
          // prepend it so the vector says WHERE the code lives, not just what
          // it does. Chunks without a prefix embed exactly as before. The
          // backfill path (EmbeddingBackfillService) mirrors this concat.
          const texts = out.map((c) => documentEmbeddingInput(c.text, c.contextPrefix))
          const acc: Array<Float32Array | null> = new Array(texts.length).fill(null)
          let anyEmbedded = false
          let embeddedSoFar = 0
          // Pure time spent inside successful embed() calls. The rate readout
          // divides by THIS, not by loop wall-clock: with two jobs interleaved
          // the other document's parse/persist (synchronous SQLite on the main
          // thread) steals wall-clock between batches and would drag the
          // number below what the embedder actually delivers. Failed batches
          // contribute neither chunks nor time, keeping the ratio "speed of
          // the output that was produced".
          let embedMs = 0
          const batchSize = indexingBatchSize(embedder)
          for (let start = 0; start < texts.length; ) {
            checkCancelled()
            // Return the first progress update promptly, even on a slow CPU.
            const slice = texts.slice(start, start + (start === 0 ? 1 : batchSize))
            const batchStart = performance.now()
            try {
              const vs = await embedder.embed(slice)
              this.assertSession()
              validateEmbeddingBatch(vs, slice.length)
              embedMs += performance.now() - batchStart
              for (let j = 0; j < vs.length; j++) acc[start + j] = vs[j] ?? null
              anyEmbedded = true
              embeddedSoFar += slice.length
            } catch (err) {
              this.assertSession()
              console.warn(
                `[documents] embed batch ${start}–${start + slice.length} failed for "${doc.title}", deferring to backfill:`,
                err,
              )
              // A lost worker must not cause every remaining batch to spawn
              // a fresh process during shutdown. Backfill can retry later.
              if (!embedder.isReady()) throw err
            }
            // Per-batch progress: gives a book-length document's embedding phase a
            // live "embedding n/total" in the Library row (replacing the frozen
            // "step 3/4"), and the per-call send ticks the monotonic counter the
            // app-quit drain + auto-lock watchdog read as liveness. Count only
            // successfully-embedded chunks so a failed batch (deferred to backfill)
            // doesn't read as completed progress. The tick fires regardless (the
            // counter advances inside send() before the sender guard), so a wedged
            // batch that never returns correctly produces NO tick.
            // Cumulative chunks/s over this document's embedding phase rides
            // along for the Library bar's throughput readout; withheld until a
            // measurable interval has passed so the first batch can't report a
            // divide-by-near-zero spike.
            const embedS = embedMs / 1000
            send(
              'embedding',
              3,
              undefined,
              `embedding ${embeddedSoFar}/${texts.length}`,
              embeddedSoFar > 0 && embedS >= 0.2 ? embeddedSoFar / embedS : undefined,
              embeddedSoFar,
              texts.length,
            )
            start += slice.length
          }
          if (anyEmbedded) {
            vectors = acc
            activeIdentity = embedder.identity()
          }
        }
      }

      checkCancelled()
      send('persisting', 4, undefined, undefined, undefined, out.length, out.length)
      // persistChunks returns the new chunk ids in insertion order, which is the
      // same order as `out` (and therefore `vectors`). ADR-0005: this replaces
      // the old document_id+ordinal re-query against the raw PGlite handle.
      const chunkIds = await repo.persistChunks(
        doc.id,
        out.map((c) => ({
          ordinal: c.ordinal,
          text: c.text,
          pageFrom: c.pageFrom,
          pageTo: c.pageTo,
          tokenCount: estimateTokens(c.text),
          headingPath: c.headingPath,
          language: c.language,
          contextPrefix: c.contextPrefix ?? null,
        })),
      )
      this.assertSession()
      if (vectors && activeIdentity) {
        const writes: Array<{ id: number; vector: Float32Array }> = []
        for (let i = 0; i < out.length; i++) {
          const v = vectors[i]
          const id = chunkIds[i]
          if (v == null || id == null) continue
          writes.push({ id, vector: v })
        }
        if (writes.length > 0) {
          if (this.vectorSink) {
            // ADR-0005 app path: vectors go to the workspace's encrypted LanceDB
            // store; PGlite only records the embedded marker + identity.
            await this.vectorSink(
              doc.workspaceId,
              writes.map((w) => ({
                chunkId: w.id,
                documentId: doc.id,
                vector: Array.from(w.vector),
              })),
            )
            this.assertSession()
            await repo.markChunksEmbedded(
              writes.map((w) => w.id),
              activeIdentity,
            )
          } else {
            // Legacy / isolated-test path: store vectors in the pgvector column.
            await repo.setChunkEmbeddingsBatch(writes, activeIdentity)
          }
        }
      }
      this.assertSession()
      await repo.setDocumentStatus(doc.id, 'ready')
      send('done', 4)
    } catch (err) {
      if (this.invalidated) return
      if (err instanceof IndexingCancelledError) {
        const cancelledRepo = await this.database.documentsFor(doc.workspaceId)
        if (this.invalidated) return
        if (this.activeJobs.get(jobKey)?.kind === 'import')
          await cancelledRepo.deleteDocument(doc.id)
        else await cancelledRepo.setDocumentStatus(doc.id, 'failed')
        send('failed', 0, err.message)
        return
      }
      // Log so silent stalls don't hide behind a 'pending' row — without the
      // log we'd lose every parser crash, embedder timeout, or locked-DB
      // hiccup. The catch then re-resolves the repo (the try's reference is
      // out of scope here) and best-effort flips status='failed' so the UI
      // doesn't stay stuck at 'pending' forever.
      console.error(`[documents] indexing failed for ${doc.title} (#${doc.id}):`, err)
      try {
        const failRepo = await this.database.documentsFor(doc.workspaceId)
        if (this.invalidated) return
        await failRepo.setDocumentStatus(doc.id, 'failed')
      } catch {
        // DB is gone (lock/logout race) ; nothing left we can do here.
      }
      send('failed', 0, err instanceof Error ? err.message : String(err))
    } finally {
      indexingLease?.release()
    }
  }
}

// rough token estimate: ~4 chars/token for english, ~3 for german. average 3.5.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/** sha256 hex of the file at `path`. Read in one shot — files are capped at
 *  MAX_IMPORT_BYTES (50 MB), but folder-sync hashes EVERY watched file on
 *  every pass — buffering the whole file kept allocations proportional to
 *  the file size × concurrency, and a folder of 200×30 MB PDFs would spike
 *  to multiple GB. Streaming hash holds ~64 KB. */
async function sha256OfFile(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

function mimeFromExt(ext: string): string | undefined {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'application/pdf'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.txt':
      return 'text/plain'
    case '.json':
      return 'application/json'
    case '.html':
      return 'text/html'
    default:
      return undefined
  }
}
