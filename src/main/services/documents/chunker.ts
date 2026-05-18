import type { PageText } from './types'

export interface Chunk {
  text: string
  ordinal: number
  pageFrom: number
  pageTo: number
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
      chunks.push({ text: trimmed, ordinal: ordinal++, pageFrom: page.num, pageTo: page.num })
    }
  }
  return chunks
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
