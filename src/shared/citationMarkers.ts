/** Citation syntax identifies a supplied passage; it does not prove claim support. */
export interface CitationMarker {
  documentId: number
  chunkId: number
}

export interface CitationMatch extends CitationMarker {
  start: number
  end: number
}

const CITATION_REGEX = /\[doc:\s*(\d+)\s*,\s*chunk:\s*(\d+)\s*\]/g
const validId = (value: number): boolean => Number.isSafeInteger(value) && value > 0

/** Protect common Markdown literals before examining markers. This span scanner
 * preserves original bytes; it is not a Markdown renderer. */
function literalMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length)
  const protect = (start: number, end: number): void => {
    mask.fill(1, start, end)
  }
  let fence: { char: string; length: number } | null = null
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0]
    if (!line) continue
    const start = match.index!
    const content = line
      .replace(/^(?: {0,3}>[ \t]?)+/, '')
      .replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]/, '')
    const run = /^ {0,3}(`{3,}|~{3,})([^\n]*)/.exec(content)
    if (fence) {
      protect(start, start + line.length)
      if (
        run &&
        run[1]![0] === fence.char &&
        run[1]!.length >= fence.length &&
        /^[ \t\r]*$/.test(run[2]!)
      )
        fence = null
    } else if (run && !(run[1]![0] === '`' && run[2]!.includes('`'))) {
      fence = { char: run[1]![0]!, length: run[1]!.length }
      protect(start, start + line.length)
    } else if (/^(?: {4}| {0,3}\t)/.test(content)) protect(start, start + line.length)
  }
  // Protect link destinations before backtick pairing: a tick in a URL/title
  // cannot open an inline code span that swallows later prose citations.
  for (const opening of text.matchAll(/\]\(/g)) {
    if (mask[opening.index!]) continue
    let depth = 1
    let end = opening.index! + 2
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') end++
      else if (text[end] === '(') depth++
      else if (text[end] === ')') depth--
    }
    if (!depth) protect(opening.index! + 1, end)
  }
  for (const token of text.matchAll(
    /<(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*|[^\s<>]+@[^\s<>]+|\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?)>/g,
  ))
    protect(token.index!, token.index! + token[0].length)
  for (const url of text.matchAll(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g))
    protect(url.index!, url.index! + url[0].length)
  const runs = [...text.matchAll(/`+/g)].filter((run) => !mask[run.index!])
  const nextByLength = new Map<number, number>()
  const next = new Map<number, number>()
  for (let i = runs.length - 1; i >= 0; i--) {
    const closing = nextByLength.get(runs[i]![0].length)
    if (closing !== undefined) next.set(i, closing)
    nextByLength.set(runs[i]![0].length, i)
  }
  for (let i = 0; i < runs.length; i++) {
    const opening = runs[i]!
    if (mask[opening.index!]) continue
    let backslashes = 0
    for (let j = opening.index! - 1; j >= 0 && text[j] === '\\'; j--) backslashes++
    if (backslashes % 2) continue
    const closingIndex = next.get(i)
    if (closingIndex === undefined) continue
    const closing = runs[closingIndex]!
    if (/\n[ \t\r]*\n/.test(text.slice(opening.index!, closing.index!))) continue
    protect(opening.index!, closing.index! + closing[0].length)
    i = closingIndex
  }
  for (const comment of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
    if (!mask[comment.index!]) protect(comment.index!, comment.index! + comment[0].length)
  }
  const referenceLabels = new Set<string>()
  const normalizeLabel = (label: string): string => label.replace(/\s+/g, ' ').trim().toLowerCase()
  for (const definition of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[^\n]*/gm)) {
    if (mask[definition.index!]) continue
    referenceLabels.add(normalizeLabel(definition[1]!))
    protect(definition.index!, definition.index! + definition[0].length)
  }
  const brackets: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (mask[i]) continue
    if (text[i] === '\\') {
      if (text[i + 1] === '[') protect(i + 1, i + 2)
      i++
      continue
    }
    if (text[i] === '[') brackets.push(i)
    else if (text[i] === ']' && brackets.length) {
      const start = brackets.pop()!
      if (referenceLabels.has(normalizeLabel(text.slice(start + 1, i)))) protect(start, i + 1)
      let after = i + 1
      while (after < text.length && /[ \t\r\n]/.test(text[after]!) && after - i <= 256) after++
      if (
        text[after] === ':' &&
        /^ {0,3}$/.test(text.slice(text.lastIndexOf('\n', start - 1) + 1, start))
      ) {
        const end = text.indexOf('\n', after)
        protect(start, end < 0 ? text.length : end)
      } else if (text[i + 1] === '(') {
        let depth = 1
        let end = i + 2
        for (; end < text.length && depth; end++) {
          if (text[end] === '\\') end++
          else if (text[end] === '(') depth++
          else if (text[end] === ')') depth--
        }
        if (!depth) protect(start, end)
      } else if (text[after] === '[' && !/^\[doc:\s*\d+\s*,\s*chunk:/.test(text.slice(after))) {
        const end = text.indexOf(']', after + 1)
        if (end >= 0 && end - after < 1000) protect(start, end + 1)
      }
    }
  }
  return mask
}

function rawMatches(text: string): CitationMatch[] {
  const mask = literalMask(text)
  return [...text.matchAll(new RegExp(CITATION_REGEX.source, 'g'))]
    .filter((match) => !mask[match.index!])
    .map((match) => ({
      documentId: Number(match[1]),
      chunkId: Number(match[2]),
      start: match.index!,
      end: match.index! + match[0].length,
    }))
}

/** Prose markers only, in mention order with duplicates retained. */
export function findCitationMatches(text: string): CitationMatch[] {
  return rawMatches(text).filter((m) => validId(m.documentId) && validId(m.chunkId))
}

export function extractCitationMarkers(text: string): CitationMarker[] {
  return findCitationMatches(text).map(({ documentId, chunkId }) => ({ documentId, chunkId }))
}

export function stripCitationMarkers(text: string): string {
  let out = ''
  let cursor = 0
  for (const marker of findCitationMatches(text)) {
    out += text.slice(cursor, marker.start)
    cursor = marker.end
  }
  return out + text.slice(cursor)
}

/** No-marker answers may retain provided context for navigation. Failed
 * citation attempts must never acquire unrelated supplied passages. */
export function reconcileCitations<T>(
  answerText: string,
  fed: readonly T[],
  keyOf: (c: T) => string,
): T[] {
  const markers = rawMatches(answerText)
  const byKey = new Map(fed.map((citation) => [keyOf(citation), citation]))
  if (!markers.length) return [...byKey.values()]
  const seen = new Set<string>()
  const out: T[] = []
  for (const marker of markers) {
    if (!validId(marker.documentId) || !validId(marker.chunkId)) continue
    const key = `${marker.documentId}-${marker.chunkId}`
    const citation = byKey.get(key)
    if (citation !== undefined && !seen.has(key)) {
      seen.add(key)
      out.push(citation)
    }
  }
  return out
}

export function hasCitedSources(text: string, allowed: ReadonlySet<string>): boolean {
  return findCitationMatches(text).some((m) => allowed.has(`${m.documentId}-${m.chunkId}`))
}

/** Invalid markers stay visible as literal text, never clickable evidence. */
export function transformCitationMarkers(
  text: string,
  allowed: ReadonlySet<string> = new Set(),
): {
  text: string
  markers: Array<CitationMarker & { index: number }>
} {
  const markers: Array<CitationMarker & { index: number }> = []
  const indices = new Map<string, number>()
  let transformed = ''
  let cursor = 0
  for (const marker of findCitationMatches(text)) {
    const key = `${marker.documentId}-${marker.chunkId}`
    if (!allowed.has(key)) continue
    let index = indices.get(key)
    if (index === undefined) {
      index = markers.length + 1
      indices.set(key, index)
      markers.push({ documentId: marker.documentId, chunkId: marker.chunkId, index })
    }
    transformed +=
      text.slice(cursor, marker.start) + `[${index}](#cite-${marker.documentId}-${marker.chunkId})`
    cursor = marker.end
  }
  return { text: transformed + text.slice(cursor), markers }
}

export function parseCiteHref(href: string | undefined): CitationMarker | null {
  const match = href?.match(/^#cite-(\d+)-(\d+)$/)
  if (!match) return null
  const documentId = Number(match[1])
  const chunkId = Number(match[2])
  return validId(documentId) && validId(chunkId) ? { documentId, chunkId } : null
}
