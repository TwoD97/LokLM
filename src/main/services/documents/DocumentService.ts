import { basename, extname } from 'node:path'
import { statSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import type { WebContents } from 'electron'
import type { AuthService } from '../auth/AuthService'
import type { Document } from '../../db/schema'
import type { ProviderRegistry } from '../providers/Registry'
import { ImportError, type IndexProgress } from './types'
import { isSupported, parseFile } from './parser'
import { chunkPages, chunkMarkdown, tagChunksWithSections, type Chunk } from './chunker'

const MAX_IMPORT_BYTES = 50 * 1024 * 1024 // Pflichtenheft §3.9

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
  ) {}

  async importFile(input: ImportInput): Promise<Document> {
    if (!isSupported(input.sourcePath)) {
      throw new ImportError(
        `Unsupported file type: ${basename(input.sourcePath)}`,
        'unsupported',
        input.sourcePath,
      )
    }
    let stat
    try {
      stat = statSync(input.sourcePath)
    } catch (err) {
      throw new ImportError(
        `Cannot read ${basename(input.sourcePath)}: ${err instanceof Error ? err.message : String(err)}`,
        'unreadable',
        input.sourcePath,
      )
    }
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new ImportError(
        `${basename(input.sourcePath)} is ${(stat.size / 1024 / 1024).toFixed(1)} MB, exceeds the 50 MB import limit.`,
        'too_large',
        input.sourcePath,
      )
    }
    const mime = mimeFromExt(extname(input.sourcePath))
    const repo = this.auth.requireDatabase().documents()
    const doc = await repo.addDocument({
      workspaceId: input.workspaceId,
      title: basename(input.sourcePath),
      sourcePath: input.sourcePath,
      mimeType: mime,
      byteSize: stat.size,
    })
    void this.indexInBackground(doc, input).catch(() => {
      // errors are surfaced via IPC; swallow here to keep the unhandled-rejection
      // listener quiet — indexInBackground already wrote status='failed' on the doc.
    })
    return doc
  }

  private async indexInBackground(doc: Document, input: ImportInput): Promise<void> {
    const TOTAL = 4
    const sender = input.sender
    const send = (phase: IndexProgress['phase'], step: number, error?: string): void => {
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
        sender.send('indexing:progress', payload)
      } catch {
        // renderer gone
      }
    }
    const repo = this.auth.requireDatabase().documents()
    try {
      await repo.setDocumentStatus(doc.id, 'indexing')
      send('parsing', 1)
      const parsed = await parseFile(doc.sourcePath)

      send('chunking', 2)
      const chunkOpts: Parameters<typeof chunkPages>[1] = {}
      if (input.chunkSize !== undefined) chunkOpts.maxChars = input.chunkSize
      if (input.chunkOverlap !== undefined) chunkOpts.overlap = input.chunkOverlap
      // Markdown gets section-aware chunking so citations can render breadcrumbs
      // ("§ Introduction › Why MD") rather than the meaningless "p. 1" we'd
      // otherwise emit for a single-page markdown ParsedDocument. PDFs use
      // page-based chunking, then we overlay the bookmark outline (when the
      // author shipped one) so citations get both "§ Chapter 2" AND "p. 14".
      let out: Chunk[]
      if (parsed.kind === 'markdown') {
        out = chunkMarkdown(parsed.sections, chunkOpts)
      } else if (parsed.kind === 'pdf' && parsed.sections.length > 0) {
        out = tagChunksWithSections(chunkPages(parsed.pages, chunkOpts), parsed.sections)
      } else {
        out = chunkPages(parsed.pages, chunkOpts)
      }

      // Embed first, persist second. Order matters: we need the chunk text
      // available for embed() before the DB row exists, so we batch the
      // forward pass over `out` then map vectors back to inserted rows by
      // ordinal. The registry is optional — DocumentService is constructed
      // without one in unit tests + the auth-flow integration paths, so the
      // embedding phase silently degrades to a no-op (Spec 1 behaviour).
      //
      // The provider contract throws on failure (no embedder model on disk,
      // Ollama unreachable, per-passage embed error). Where the old
      // EmbeddingService returned per-item nulls, the provider throws once
      // for the batch; we catch and leave vectors=null so chunks persist
      // with embedding=NULL — the backfill service picks them up later.
      send('embedding', 3)
      let vectors: Float32Array[] | null = null
      let activeIdentity: string | null = null
      if (this.registry) {
        const embedder = this.registry.embedder()
        await embedder.ensureReady()
        if (embedder.isReady()) {
          try {
            vectors = await embedder.embed(out.map((c) => c.text))
            activeIdentity = embedder.identity()
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              '[documents] embedder failed during indexing, chunks will need backfill:',
              err,
            )
            vectors = null
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
        })),
      )
      if (vectors && activeIdentity) {
        // chunks were just inserted; fetch their ids by document_id + ordinal
        // and write embeddings. one round-trip to get the id map, then one
        // UPDATE per non-null vector — fine at PAGE-sized batches.
        const db = this.auth.requireDatabase().db
        const rows = await db.execute(sql`
          SELECT id, ordinal FROM chunks WHERE document_id = ${doc.id} ORDER BY ordinal
        `)
        const byOrdinal = new Map<number, number>(
          (rows.rows as { id: number; ordinal: number }[]).map((r) => [r.ordinal, r.id]),
        )
        for (let i = 0; i < out.length; i++) {
          const v = vectors[i]
          const ord = out[i]?.ordinal
          if (v == null || ord == null) continue
          const id = byOrdinal.get(ord)
          if (id != null) await repo.setChunkEmbedding(id, Array.from(v), activeIdentity)
        }
      }
      await repo.setDocumentStatus(doc.id, 'ready')
      send('done', 4)
    } catch (err) {
      await repo.setDocumentStatus(doc.id, 'failed').catch(() => undefined)
      send('failed', 0, err instanceof Error ? err.message : String(err))
    }
  }
}

// rough token estimate: ~4 chars/token for english, ~3 for german. average 3.5.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function mimeFromExt(ext: string): string | undefined {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'application/pdf'
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
