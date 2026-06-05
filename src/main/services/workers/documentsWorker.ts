// Dedicated document-processing worker: parse → (OCR) → chunk, off the main
// event loop and isolated from the models worker. Spawned via
// utilityProcess.fork from main/index.ts (see DocumentsWorkerClient).
//
// Heavy work that lives here:
//   - pdf-parse / pdfjs text extraction (book-length PDFs)
//   - tesseract.js OCR + @napi-rs/canvas rasterisation of scanned pages
//   - the section-aware chunker + eld per-chunk language tagging
//
// Communication is via process.parentPort: one response per request id; OCR
// progress + logs are pushed without an id and fanned out on the main side.

// pdfjs-dist (loaded lazily by pdf-parse on first parsePdf) constructs a
// module-level `new DOMMatrix()` at import time. utilityProcess has no DOM, so
// the import throws `DOMMatrix is not defined`. Stub an identity no-op so the
// import succeeds; text extraction never uses it. The OCR module replaces this
// with the real @napi-rs/canvas DOMMatrix before it rasterises a page (see
// ocr.ts installCanvasGlobals).
if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  class DOMMatrixPolyfill {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
    constructor(init?: number[] | string | DOMMatrixPolyfill) {
      if (Array.isArray(init) && init.length >= 6) {
        ;[this.a, this.b, this.c, this.d, this.e, this.f] = init as [
          number,
          number,
          number,
          number,
          number,
          number,
        ]
      }
    }
    multiplySelf(): this {
      return this
    }
    preMultiplySelf(): this {
      return this
    }
    invertSelf(): this {
      return this
    }
    translateSelf(): this {
      return this
    }
    translate(): this {
      return this
    }
    scaleSelf(): this {
      return this
    }
    scale(): this {
      return this
    }
  }
  ;(globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill
}

import type {
  DocWorkerRequest,
  DocWorkerResponse,
  DocWorkerPush,
  ParseAndChunkPayload,
  ParseAndChunkResult,
} from './documentsProtocol'
import { parseFile } from '../documents/parser'
import {
  chunkMarkdown,
  chunkPages,
  tagChunksWithSections,
  tagChunkLanguages,
} from '../documents/chunker'
import { terminateOcr } from '../documents/ocr'

// utilityProcess provides process.parentPort with postMessage / on('message').
declare const process: NodeJS.Process & {
  parentPort: {
    postMessage: (msg: unknown) => void
    on: (ev: 'message', cb: (msg: DocWorkerRequest) => void) => void
  }
}

function send(msg: DocWorkerResponse | DocWorkerPush): void {
  process.parentPort.postMessage(msg)
}

function reply<T>(id: number, result: T): void {
  send({ id, ok: true, result } as DocWorkerResponse<T>)
}

function fail(id: number, err: unknown): void {
  send({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  send({ ev: 'log', level, message })
}

async function parseAndChunk(payload: ParseAndChunkPayload): Promise<ParseAndChunkResult> {
  const documentId = payload.documentId ?? null
  const parsed = await parseFile(payload.sourcePath, {
    onOcrProgress: (done, total) => send({ ev: 'ocr', documentId, done, total }),
  })
  const opts: Partial<{ maxChars: number; overlap: number }> = {}
  if (payload.chunkSize !== undefined) opts.maxChars = payload.chunkSize
  if (payload.chunkOverlap !== undefined) opts.overlap = payload.chunkOverlap
  let chunks
  if (parsed.kind === 'markdown') {
    chunks = chunkMarkdown(parsed.sections, opts)
  } else if (parsed.kind === 'pdf' && parsed.sections.length > 0) {
    chunks = tagChunksWithSections(chunkPages(parsed.pages, opts), parsed.sections)
  } else {
    chunks = chunkPages(parsed.pages, opts)
  }
  // Language-tag AFTER section tagging so eld sees the final chunk text
  // (heading prefixes included), matching what the LLM reads at retrieval time.
  chunks = await tagChunkLanguages(chunks)
  return { chunks }
}

process.parentPort.on('message', (raw: DocWorkerRequest) => {
  const msg = (raw as unknown as { data?: DocWorkerRequest }).data ?? raw
  void handle(msg).catch((err) => {
    if ('id' in msg) fail(msg.id, err)
    else log('error', err instanceof Error ? err.message : String(err))
  })
})

async function handle(msg: DocWorkerRequest): Promise<void> {
  switch (msg.op) {
    case 'documents.parseAndChunk':
      reply(msg.id, await parseAndChunk(msg.payload))
      return
    case 'shutdown': {
      reply(msg.id, null)
      // Let the ack drain before tearing down the tesseract worker thread.
      await new Promise<void>((r) => setImmediate(r))
      try {
        await terminateOcr()
      } finally {
        process.exit(0)
      }
      return
    }
    default: {
      const _exhaustive: never = msg
      const id = (msg as { id?: unknown }).id
      if (typeof id === 'number') fail(id, `Unknown op: ${JSON.stringify(_exhaustive)}`)
      else log('warn', `dropped malformed request: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

log('info', 'documentsWorker ready')
