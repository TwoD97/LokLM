import { basename, extname } from 'node:path'
import { statSync } from 'node:fs'
import type { WebContents } from 'electron'
import type { AuthService } from '../auth/AuthService'
import type { Document } from '../../db/schema'
import { ImportError, type IndexProgress } from './types'
import { isSupported, parseFile } from './parser'
import { chunkPages, type Chunk } from './chunker'

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
  constructor(private readonly auth: AuthService) {}

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
      const out: Chunk[] = chunkPages(parsed.pages, chunkOpts)

      // Spec 1: embedding phase is a no-op. Spec 2 wires BGE-M3 here.
      send('embedding', 3)

      send('persisting', 4)
      await repo.persistChunks(
        doc.id,
        out.map((c) => ({
          ordinal: c.ordinal,
          text: c.text,
          pageFrom: c.pageFrom,
          pageTo: c.pageTo,
          tokenCount: estimateTokens(c.text),
        })),
      )
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
