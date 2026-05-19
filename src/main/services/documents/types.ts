export interface PageText {
  num: number
  text: string
}

export interface ParsedDocument {
  pages: PageText[]
  fullText: string
  kind: 'pdf' | 'text'
}

export type ImportErrorCode = 'unsupported' | 'too_large' | 'unreadable'

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: ImportErrorCode,
    readonly path: string,
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

export interface IndexProgress {
  documentId: number
  title: string
  phase: 'parsing' | 'chunking' | 'embedding' | 'persisting' | 'done' | 'failed'
  step: number
  total: number
  error?: string
}
