import { basename, extname } from 'node:path'
import { statSync, type Stats } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { WebContents } from 'electron'
import type { AuthService } from '../auth/AuthService'
import type { Document } from '../../db/schema'
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

const MAX_IMPORT_BYTES = 50 * 1024 * 1024 // Pflichtenheft §3.9

// Import-time embedding page size. Matches EmbeddingBackfillService's PAGE so
// both ingest paths round-trip the embedder in equal, memory-bounded batches
// and a single failing passage only affects its own page.
const EMBED_BATCH = 32

type ProgressSender = WebContents | { send: (channel: string, payload: IndexProgress) => void }

export interface ImportInput {
  workspaceId: number
  sourcePath: string
  sender?: ProgressSender
  chunkSize?: number
  chunkOverlap?: number
}

export class DocumentService {
  constructor(
    private readonly auth: AuthService,
    private readonly registry?: ProviderRegistry,
    /** Optional worker client. When present, parseFile + OCR + chunker run in
     *  the dedicated documentsWorker utilityProcess so a book-length or scanned
     *  PDF doesn't pin the main event loop (and never competes with chat-token
     *  streaming on the models worker). Tests construct DocumentService without
     *  one and the inline path is used as a fallback. */
    private readonly worker?: DocumentsWorkerClient,
  ) {}

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
  private readonly indexQueue: Array<{
    doc: Document
    input: ImportInput
    /** 'import' rows are placeholders with no chunks yet — cancellation may
     *  delete them. 'reindex' rows are real docs (chunks already wiped by
     *  reindex_document); cancellation marks them failed instead of deleting. */
    kind: 'import' | 'reindex'
  }> = []

  private enqueueIndexing(doc: Document, input: ImportInput, kind: 'import' | 'reindex'): void {
    this.indexQueue.push({ doc, input, kind })
    this.pumpIndexQueue()
  }

  private pumpIndexQueue(): void {
    while (
      this.activeIndexing < DocumentService.MAX_CONCURRENT_INDEXING &&
      this.indexQueue.length > 0
    ) {
      const job = this.indexQueue.shift()!
      this.activeIndexing += 1
      void this.indexInBackground(job.doc, job.input)
        .catch(() => {
          // errors are surfaced via the IPC progress 'failed' event and the
          // doc row's status; indexInBackground never rejects with anything we
          // need to act on here.
        })
        .finally(() => {
          this.activeIndexing -= 1
          this.pumpIndexQueue()
        })
    }
  }

  /** Drop every not-yet-started indexing job for a workspace. Import
   *  placeholders (no chunks) are deleted outright; reindex jobs (real docs
   *  whose chunks were already wiped) are marked 'failed' so the user can
   *  retry. Jobs already running are left to finish — the worker requests
   *  aren't abortable mid-parse. Returns how many queued jobs were cancelled. */
  async cancelWorkspaceIndexing(workspaceId: number): Promise<number> {
    const cancelled: typeof this.indexQueue = []
    for (let i = this.indexQueue.length - 1; i >= 0; i--) {
      if (this.indexQueue[i]!.input.workspaceId === workspaceId) {
        cancelled.push(this.indexQueue.splice(i, 1)[0]!)
      }
    }
    if (cancelled.length === 0) return 0
    const repo = this.auth.requireDatabase().documents()
    for (const job of cancelled) {
      try {
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
    return this.auth.requireDatabase().documents().resetStuckIndexing()
  }

  async importFile(input: ImportInput): Promise<Document> {
    const { stat, hash } = await this.statAndHashOrThrow(input.sourcePath)
    const mime = mimeFromExt(extname(input.sourcePath))
    const repo = this.auth.requireDatabase().documents()
    // Guard the unique (workspace_id, source_path) index in JS so callers get a
    // coded ImportError instead of a raw SQL stack. Pre-fix, the bug surfaced
    // as `documents:reindex` doing reindex_document + importFile back-to-back ,
    // any future caller that loops sync+import or otherwise re-imports an
    // already-vectorized path would have hit the same opaque trace. Reindex is
    // the right verb for this case ; this layer just refuses to be the one
    // that masks it.
    const existing = await repo.findByWorkspaceAndPath(input.workspaceId, input.sourcePath)
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
      mimeType: mime,
      byteSize: stat.size,
      contentHash: hash,
      sourceMtime: Math.round(stat.mtimeMs),
    })
    this.enqueueIndexing(doc, input, 'import')
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
  ): Promise<Document> {
    const repo = this.auth.requireDatabase().documents()
    if (!(await repo.getDocument(documentId))) {
      throw new Error(`Document ${documentId} not found`)
    }
    const { stat, hash } = await this.statAndHashOrThrow(newPath)
    await repo.reindexDocument(documentId) // wipes chunks, sets status='pending'
    await repo.setSourceMetadata(documentId, {
      sourcePath: newPath,
      title: basename(newPath),
      mimeType: mimeFromExt(extname(newPath)) ?? null,
      byteSize: stat.size,
      contentHash: hash,
      sourceMtime: Math.round(stat.mtimeMs),
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
  ): Promise<'unchanged' | 'reindexed' | 'missing'> {
    const repo = this.auth.requireDatabase().documents()
    const doc = await repo.getDocument(documentId)
    if (!doc) throw new Error(`Document ${documentId} not found`)
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
    if (doc.sourceMtime != null && doc.sourceMtime === mtime && doc.contentHash != null) {
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
    if (doc.contentHash === hash) {
      // touch-only — refresh mtime so the next probe short-circuits.
      await repo.setSourceMetadata(documentId, { sourceMtime: mtime })
      return 'unchanged'
    }
    await repo.reindexDocument(documentId)
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
  }

  /** User-triggered "Reindex" button. Unconditionally wipes chunks + re-parses
   *  the existing source path against the existing doc row , no insert , no
   *  hash short-circuit. ImportError surfaces if the file vanished or is
   *  oversized so the renderer can show the same toast as the import flow. */
  async reindex(documentId: number, sender?: ProgressSender): Promise<Document> {
    const repo = this.auth.requireDatabase().documents()
    const doc = await repo.getDocument(documentId)
    if (!doc) throw new Error(`Document ${documentId} not found`)
    const { stat, hash } = await this.statAndHashOrThrow(doc.sourcePath)
    await repo.reindexDocument(documentId)
    await repo.setSourceMetadata(documentId, {
      byteSize: stat.size,
      contentHash: hash,
      sourceMtime: Math.round(stat.mtimeMs),
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

  private async indexInBackground(doc: Document, input: ImportInput): Promise<void> {
    const TOTAL = 4
    const sender = input.sender
    const send = (
      phase: IndexProgress['phase'],
      step: number,
      error?: string,
      detail?: string,
    ): void => {
      if (!sender) return
      try {
        const payload: IndexProgress = {
          documentId: doc.id,
          title: doc.title,
          phase,
          step,
          total: TOTAL,
        }
        if (error !== undefined) payload.error = error
        if (detail !== undefined) payload.detail = detail
        sender.send('indexing:progress', payload)
      } catch {
        // renderer gone
      }
    }
    // requireDatabase() used to live outside this try, which meant a lock or
    // logout firing between addDocument and the first await would throw past
    // indexInBackground entirely, leave the row stuck at 'pending', and the
    // outer .catch(() => {}) in importFile would silently eat it. Moving it
    // inside guarantees the catch arm at the bottom flips status='failed' so
    // the row reflects what actually happened.
    try {
      const repo = this.auth.requireDatabase().documents()
      await repo.setDocumentStatus(doc.id, 'indexing')
      send('parsing', 1)

      // Markdown gets section-aware chunking so citations can render breadcrumbs
      // ("§ Introduction › Why MD") rather than the meaningless "p. 1" we'd
      // otherwise emit for a single-page markdown ParsedDocument. PDFs use
      // page-based chunking, then we overlay the bookmark outline (when the
      // author shipped one) so citations get both "§ Chapter 2" AND "p. 14".
      // The worker path runs both parse + chunk off the main event loop so
      // the renderer stays responsive even on book-length PDFs ; the inline
      // path is the fallback for tests/contexts without a worker.
      let out: Chunk[]
      if (this.worker) {
        const chunkPayload: {
          sourcePath: string
          documentId: number
          chunkSize?: number
          chunkOverlap?: number
        } = {
          sourcePath: doc.sourcePath,
          documentId: doc.id,
        }
        if (input.chunkSize !== undefined) chunkPayload.chunkSize = input.chunkSize
        if (input.chunkOverlap !== undefined) chunkPayload.chunkOverlap = input.chunkOverlap
        // Surface scanned-page OCR progress under the parsing phase so a slow
        // OCR pass reads as progress, not a hang. Unregister once parse returns.
        const offOcr = this.worker.registerOcrProgress(doc.id, (done, total) =>
          send('parsing', 1, undefined, `OCR ${done}/${total}`),
        )
        try {
          const { chunks: workerChunks } = await this.worker.parseAndChunk(chunkPayload)
          out = workerChunks
        } finally {
          offOcr()
        }
        send('chunking', 2)
      } else {
        const parsed = await parseFile(doc.sourcePath, {
          onOcrProgress: (done, total) => send('parsing', 1, undefined, `OCR ${done}/${total}`),
        })
        send('chunking', 2)
        const chunkOpts: Parameters<typeof chunkPages>[1] = {}
        if (input.chunkSize !== undefined) chunkOpts.maxChars = input.chunkSize
        if (input.chunkOverlap !== undefined) chunkOpts.overlap = input.chunkOverlap
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
      // in fixed-size batches (mirroring EmbeddingBackfillService's PAGE=32)
      // rather than embedding every chunk in one call: a book-length or OCR'd
      // PDF can be hundreds of passages, and a single embed() over all of them
      // is both a memory/timeout spike AND all-or-nothing — one bad passage
      // throws for the whole batch and NULLs the entire document's vectors.
      // Batching isolates a failure to its own page; the rest persist embedded
      // and only the failed page defers to the backfill service.
      send('embedding', 3)
      let vectors: Array<Float32Array | null> | null = null
      let activeIdentity: string | null = null
      if (this.registry) {
        const embedder = this.registry.embedder()
        await embedder.ensureReady()
        if (embedder.isReady()) {
          const texts = out.map((c) => c.text)
          const acc: Array<Float32Array | null> = new Array(texts.length).fill(null)
          let anyEmbedded = false
          for (let start = 0; start < texts.length; start += EMBED_BATCH) {
            const slice = texts.slice(start, start + EMBED_BATCH)
            try {
              const vs = await embedder.embed(slice)
              for (let j = 0; j < vs.length; j++) acc[start + j] = vs[j] ?? null
              anyEmbedded = true
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[documents] embed batch ${start}–${start + slice.length} failed for "${doc.title}", deferring to backfill:`,
                err,
              )
            }
          }
          if (anyEmbedded) {
            vectors = acc
            activeIdentity = embedder.identity()
          }
        }
      }

      send('persisting', 4)
      await repo.persistChunks(
        doc.id,
        out.map((c) => ({
          ordinal: c.ordinal,
          text: c.text,
          pageFrom: c.pageFrom,
          pageTo: c.pageTo,
          tokenCount: estimateTokens(c.text),
          headingPath: c.headingPath,
          language: c.language,
        })),
      )
      if (vectors && activeIdentity) {
        // chunks were just inserted; fetch their ids by document_id + ordinal
        // and write embeddings in ONE multi-row UPDATE. Per-chunk UPDATEs were
        // the dominant cost of large imports — a 500-chunk PDF was 500
        // round-trips through the pglite JS boundary.
        const db = this.auth.requireDatabase().db
        const rows = await db.execute(sql`
          SELECT id, ordinal FROM chunks WHERE document_id = ${doc.id} ORDER BY ordinal
        `)
        const byOrdinal = new Map<number, number>(
          (rows.rows as { id: number; ordinal: number }[]).map((r) => [r.ordinal, r.id]),
        )
        const writes: Array<{ id: number; vector: Float32Array }> = []
        for (let i = 0; i < out.length; i++) {
          const v = vectors[i]
          const ord = out[i]?.ordinal
          if (v == null || ord == null) continue
          const id = byOrdinal.get(ord)
          if (id != null) writes.push({ id, vector: v })
        }
        if (writes.length > 0) {
          await repo.setChunkEmbeddingsBatch(writes, activeIdentity)
        }
      }
      await repo.setDocumentStatus(doc.id, 'ready')
      send('done', 4)
    } catch (err) {
      // Log so silent stalls don't hide behind a 'pending' row — without the
      // log we'd lose every parser crash, embedder timeout, or locked-DB
      // hiccup. The catch then re-resolves the repo (the try's reference is
      // out of scope here) and best-effort flips status='failed' so the UI
      // doesn't stay stuck at 'pending' forever.
      // eslint-disable-next-line no-console
      console.error(`[documents] indexing failed for ${doc.title} (#${doc.id}):`, err)
      try {
        const failRepo = this.auth.requireDatabase().documents()
        await failRepo.setDocumentStatus(doc.id, 'failed')
      } catch {
        // DB is gone (lock/logout race) ; nothing left we can do here.
      }
      send('failed', 0, err instanceof Error ? err.message : String(err))
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
