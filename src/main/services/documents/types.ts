export interface PageText {
  num: number
  text: string
}

/** A single heading-bounded section of a markdown document. `headingPath`
 *  is the breadcrumb from the document root down to this section's own
 *  heading; an empty array means content above the first heading (preamble). */
export interface MarkdownSection {
  headingPath: string[]
  /** Section body, NOT including the heading line itself. */
  text: string
}

/** A single PDF bookmark resolved to a page number. PDFs without an outline
 *  produce `sections: []`; the chunker then falls back to plain page-based
 *  chunking with no heading_path tags. */
export interface PdfSection {
  headingPath: string[]
  /** 1-indexed page on which this bookmark's destination lives. */
  pageStart: number
}

export type ParsedDocument =
  | { kind: 'pdf'; pages: PageText[]; fullText: string; sections: PdfSection[] }
  | { kind: 'text'; pages: PageText[]; fullText: string }
  | { kind: 'markdown'; sections: MarkdownSection[]; pages: PageText[]; fullText: string }

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
