import type { HighlightedSegment } from './fuzzyHighlight'
import type { LibraryDocType } from './documents'

// ts_headline excerpt delimiters (see DocumentsRepo.searchLibrary). U+27E6/27E7
// — mathematical white brackets — never occur in real document text, so we can
// split on them without HTML escaping and render <mark> elements safely.
export const HEADLINE_START = '⟦'
export const HEADLINE_STOP = '⟧'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Mirrors the code/markup half of TEXT_EXTS in
// src/main/services/documents/parser.ts. Kept here (not imported) because
// src/shared must not depend on src/main; src/shared/docType.test.ts pins them
// in sync against the SQL CASE in searchLibrary. .md/.markdown/.txt/.rst are
// intentionally absent — they classify as 'md'/'txt'.
const CODE_EXTS = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.sh',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.xml',
])

export const LIBRARY_DOC_TYPES: LibraryDocType[] = ['pdf', 'md', 'txt', 'code', 'docx']

/** Map a source path (+ optional mime) to one of the five filterable buckets.
 *  Extension is authoritative (mime_type is null for most text/code files); the
 *  mime is only a tiebreaker when the path carries no recognised extension. */
export function classifyDocType(sourcePath: string, mimeType?: string | null): LibraryDocType {
  const p = sourcePath.toLowerCase()
  const dot = p.lastIndexOf('.')
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const ext = dot > slash ? p.slice(dot) : '' // ignore dots in directory names
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.md' || ext === '.markdown') return 'md'
  if (CODE_EXTS.has(ext)) return 'code'
  if (ext === '.txt' || ext === '.rst') return 'txt'
  // no recognised extension — fall back to the mime, then to txt.
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === DOCX_MIME) return 'docx'
  return 'txt'
}

/** Split a ts_headline excerpt marked with ⟦…⟧ into alternating plain/highlighted
 *  segments. Empty segments (adjacent or edge markers) are dropped. Renderer maps
 *  each segment to <span>/<mark> — never innerHTML, so untrusted text stays inert. */
export function splitSentinels(headline: string): HighlightedSegment[] {
  const out: HighlightedSegment[] = []
  let highlighted = false
  let buf = ''
  for (const ch of headline) {
    if (ch === HEADLINE_START || ch === HEADLINE_STOP) {
      if (buf) out.push({ text: buf, highlighted })
      buf = ''
      highlighted = ch === HEADLINE_START
    } else {
      buf += ch
    }
  }
  if (buf) out.push({ text: buf, highlighted })
  return out
}
