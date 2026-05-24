import type { MarkdownSection, PageText, PdfSection } from './types'
import { detectChunkLanguages, type ChunkLanguage } from './languageDetector'

export interface Chunk {
  text: string
  ordinal: number
  /** PDFs and text files set these to the source page; markdown chunks leave
   *  them null and use `headingPath` instead. */
  pageFrom: number | null
  pageTo: number | null
  /** Hierarchical heading breadcrumb. Populated only by chunkMarkdown. */
  headingPath: string[] | null
  /** Detected per-chunk language (eld, mig 0007). Null when detection was
   *  skipped (chunker producers leave it null ; `tagChunkLanguages` fills
   *  it in as a post-pass so the language-detector import stays out of the
   *  synchronous chunking hot path). */
  language: ChunkLanguage | null
}

export interface ChunkOptions {
  maxChars: number
  overlap: number
}

const DEFAULT: ChunkOptions = { maxChars: 2000, overlap: 200 }

const SEPARATORS: string[] = ['\n\n\n', '\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ']

export function chunkPages(pages: PageText[], opts: Partial<ChunkOptions> = {}): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT.maxChars
  const overlap = opts.overlap ?? DEFAULT.overlap
  const chunks: Chunk[] = []
  let ordinal = 0

  for (const page of pages) {
    const pieces = splitText(page.text, maxChars)
    const merged = mergeWithOverlap(pieces, maxChars, overlap)
    for (const text of merged) {
      const trimmed = text.trim()
      if (trimmed.length === 0) continue
      chunks.push({
        text: trimmed,
        ordinal: ordinal++,
        pageFrom: page.num,
        pageTo: page.num,
        headingPath: null,
        language: null,
      })
    }
  }
  return chunks
}

/**
 * Section-aware markdown chunking.
 *
 *  - Each markdown section (heading + body) becomes one chunk when it fits
 *    within `maxChars`. Section boundaries are NEVER crossed: this is what
 *    lets the LLM cite a specific heading rather than "p. 5".
 *  - Sections larger than `maxChars` are split with the same separator
 *    cascade as PDFs — but each piece inherits the full `headingPath`, so
 *    citations remain accurate even when a long section is fragmented.
 *  - Adjacent sections are NOT merged. A short "Introduction" followed by
 *    "Conclusion" stays two chunks, because mixing two unrelated breadcrumbs
 *    into one chunk would lie about provenance.
 *  - The chunk text retains the section heading line as a soft prefix
 *    (`# Heading\\n\\n<body>`) so the embedding picks up the topical signal.
 */
export function chunkMarkdown(
  sections: MarkdownSection[],
  opts: Partial<ChunkOptions> = {},
): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT.maxChars
  const overlap = opts.overlap ?? DEFAULT.overlap
  const chunks: Chunk[] = []
  let ordinal = 0

  for (const section of sections) {
    const lastHeading = section.headingPath[section.headingPath.length - 1] ?? null
    const headingPrefix = lastHeading ? `# ${lastHeading}\n\n` : ''
    const body = section.text.trim()
    if (body.length === 0) continue
    const full = headingPrefix + body

    if (full.length <= maxChars) {
      chunks.push({
        text: full,
        ordinal: ordinal++,
        pageFrom: null,
        pageTo: null,
        headingPath: section.headingPath.length > 0 ? [...section.headingPath] : null,
        language: null,
      })
      continue
    }

    // Oversized section: split the body (NOT the heading prefix — we re-add
    // it to the first piece only so we don't bloat every chunk for one
    // mega-section). Subsequent pieces still carry the same headingPath,
    // which is what citations care about.
    const pieces = mergeWithOverlap(splitText(body, maxChars), maxChars, overlap)
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!.trim()
      if (piece.length === 0) continue
      const text = i === 0 && headingPrefix.length > 0 ? headingPrefix + piece : piece
      chunks.push({
        text,
        ordinal: ordinal++,
        pageFrom: null,
        pageTo: null,
        headingPath: section.headingPath.length > 0 ? [...section.headingPath] : null,
        language: null,
      })
    }
  }
  return chunks
}

/** Post-pass over a chunk list that fills in the `language` field on each
 *  chunk via eld. Kept separate from the chunk producers so the chunker
 *  module stays synchronous (eld load is async + ~140 MB resident) and so
 *  callers that don't care about language tagging (unit tests, eval
 *  bridges) don't pay the load cost. */
export async function tagChunkLanguages(chunks: Chunk[]): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks
  const languages = await detectChunkLanguages(chunks.map((c) => c.text))
  return chunks.map((c, i) => ({ ...c, language: languages[i] ?? null }))
}

/**
 *  Tag PDF chunks (produced by chunkPages) with the deepest bookmark whose
 *  pageStart is <= chunk.pageFrom. Citations then render the section
 *  breadcrumb alongside the page number.
 *
 *  Sections must already be sorted by pageStart (extractPdfOutline does this).
 *  We scan linearly per chunk — fine for typical bookmark counts (<200).
 *  Chunks falling before the first bookmark keep `headingPath: null`, which
 *  is correct: they belong to no advertised section.
 */
export function tagChunksWithSections(chunks: Chunk[], sections: PdfSection[]): Chunk[] {
  if (sections.length === 0) return chunks
  return chunks.map((c) => {
    if (c.pageFrom == null) return c
    let current: PdfSection | null = null
    for (const s of sections) {
      if (s.pageStart > c.pageFrom) break
      current = s
    }
    if (!current) return c
    return { ...c, headingPath: [...current.headingPath] }
  })
}

function splitText(text: string, maxChars: number, sepIndex = 0): string[] {
  if (text.length <= maxChars) return [text]
  if (sepIndex >= SEPARATORS.length) {
    const out: string[] = []
    for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars))
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sep = SEPARATORS[sepIndex]!
  const parts = text.split(sep)
  if (parts.length === 1) return splitText(text, maxChars, sepIndex + 1)
  const out: string[] = []
  for (const part of parts) {
    if (part.length <= maxChars) out.push(part)
    else out.push(...splitText(part, maxChars, sepIndex + 1))
  }
  return reassemble(out, sep, maxChars)
}

function reassemble(parts: string[], sep: string, maxChars: number): string[] {
  const out: string[] = []
  let buf = ''
  for (const p of parts) {
    const candidate = buf.length === 0 ? p : buf + sep + p
    if (candidate.length <= maxChars) buf = candidate
    else {
      if (buf.length > 0) out.push(buf)
      buf = p
    }
  }
  if (buf.length > 0) out.push(buf)
  return out
}

function mergeWithOverlap(pieces: string[], maxChars: number, overlap: number): string[] {
  if (overlap <= 0 || pieces.length <= 1) return pieces
  const out: string[] = []
  for (let i = 0; i < pieces.length; i++) {
    const prev = out[out.length - 1]
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let current = pieces[i]!
    if (prev && current.length + overlap <= maxChars) {
      const tail = prev.slice(-overlap)
      current = tail + (tail.endsWith(' ') ? '' : ' ') + current
    }
    out.push(current)
  }
  return out
}
