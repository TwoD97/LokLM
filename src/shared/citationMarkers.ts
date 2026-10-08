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
function literalMask(text: string, maskHtmlTags = true): Uint8Array {
  const mask = new Uint8Array(text.length)
  const protect = (start: number, end: number): void => {
    mask.fill(1, start, end)
  }
  let fence: { char: string; length: number } | null = null
  const listIndents: number[] = []
  let quoteDepth = 0
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0]
    if (!line) continue
    const start = match.index!
    const quote = /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] ?? ''
    const depth = [...quote].filter((char) => char === '>').length
    if (depth !== quoteDepth) listIndents.length = 0
    quoteDepth = depth
    // List indentation belongs to the container, not an indented code block.
    // Keep its content column across blank lines, including nested lists. Only
    // four additional columns inside that container denote indented code.
    let content = line.slice(quote.length).replace(/^[ \t]+/, (indent) => {
      let columns = 0
      for (const char of indent) columns += char === '\t' ? 4 - (columns % 4) : 1
      return ' '.repeat(columns)
    })
    const indent = /^ */.exec(content)![0].length
    if (content.trim() && !fence) {
      while (listIndents.length && indent < listIndents[listIndents.length - 1]!) listIndents.pop()
    }
    const container = listIndents[listIndents.length - 1] ?? 0
    if (indent >= container) content = content.slice(container)
    if (!fence) {
      const item = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+|(?=\r?\n?$))/.exec(content)
      if (item) {
        const markerWidth = item[0].length - item[2]!.length
        let padding = 0
        for (const char of item[2]!)
          padding += char === '\t' ? 4 - ((container + markerWidth + padding) % 4) : 1
        // More than four padding columns starts code inside the list item;
        // only its first column belongs to the marker (CommonMark list rule).
        const consumed = padding > 4 ? 1 : Math.max(1, padding)
        listIndents.push(container + markerWidth + consumed)
        content = ' '.repeat(Math.max(0, padding - consumed)) + content.slice(item[0].length)
      }
    }
    // Dollar flow uses the same line-boundary protection as code fences in the
    // actual reader (remark-math). A same-line dollar pair is inline math, not
    // a flow opener; a closing delimiter permits only trailing whitespace.
    const run = /^ {0,3}(`{3,}|~{3,}|\${2,})([^\n]*)/.exec(content)
    if (fence) {
      protect(start, start + line.length)
      if (
        run &&
        run[1]![0] === fence.char &&
        run[1]!.length >= fence.length &&
        /^[ \t\r]*$/.test(run[2]!)
      )
        fence = null
    } else if (
      run &&
      !(run[1]![0] === '`' && run[2]!.includes('`')) &&
      !(run[1]![0] === '$' && run[2]!.includes('$'))
    ) {
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
  )) {
    if (maskHtmlTags || /^<(?:[A-Za-z][A-Za-z0-9+.-]*:|[^\s<>]+@)/.test(token[0]))
      protect(token.index!, token.index! + token[0].length)
  }
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
      const separateParagraph = /\n[ \t]*\n/.test(text.slice(i + 1, after).replace(/\r\n?/g, '\n'))
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
      } else if (
        !separateParagraph &&
        text[after] === '[' &&
        !/^\[doc:\s*\d+\s*,\s*chunk:/.test(text.slice(after))
      ) {
        const end = text.indexOf(']', after + 1)
        if (end >= 0 && end - after < 1000) protect(start, end + 1)
      }
    }
  }
  return mask
}

/** Fixed structural labels only; never include source identities or text. */
export type SourceLabelRejection =
  | 'source_label_malformed'
  | 'source_label_unattached'
  | 'source_label_ambiguous'
  | 'source_label_literal_overlap'
  | 'source_label_placement'

/** Remove only redundant plain-prose `(doc:N:M)` or `(doc:N, chunk:M)` labels,
 * allowing ASCII spaces/tabs around tokens, for identities already attached
 * to this record. Other source-looking labels fail closed. This is
 * presentation cleanup, not citation inference or a check of claim support.
 * Markdown literals and ordinary quoted examples retain their original bytes. */
export function removeRedundantSourceLabels(
  text: string,
  recordSources: ReadonlySet<string>,
  onReject?: (reason: SourceLabelRejection) => void,
): string | null {
  const reject = (reason: SourceLabelRejection): null => {
    try {
      onReject?.(reason)
    } catch {
      // Observability must not affect cleanup or leak the rejected label.
    }
    return null
  }
  if (!/\([ \t]*doc[ \t]*:/iu.test(text)) return text
  const mask = literalMask(text)
  const ambiguous = new Uint8Array(text.length)
  const escaped = (at: number): boolean => {
    let count = 0
    for (let index = at - 1; index >= 0 && text[index] === '\\'; index--) count++
    return count % 2 === 1
  }
  // Blockquote paragraphs may continue lazily without another '>'. Preserve
  // those lines too, including a quote nested inside a list. A blank line or
  // an explicit new block ends lazy paragraph continuation.
  let quotedParagraph = false
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const content = line[0]
    if (!content) continue
    const quote = /^(?:[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+)*[ \t]*>[ \t]?/.exec(content)
    const interruption =
      /^[ \t]*(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|[-+*][ \t]+|1[.)][ \t]+|(?:[-*_][ \t]*){3,}$|<)/u.test(
        content.trimEnd(),
      )
    if (quote) {
      mask.fill(1, line.index!, line.index! + content.length)
      quotedParagraph = !!content
        .slice(quote[0].length)
        .replace(/^[ \t>]+/u, '')
        .trim()
    } else if (!content.trim() || interruption) quotedParagraph = false
    else if (quotedParagraph) mask.fill(1, line.index!, line.index! + content.length)
  }
  for (const math of text.matchAll(/(\${1,2})(?!\$)(?:\\.|[^$\n])*?\1(?!\$)/g)) {
    if (!escaped(math.index!)) mask.fill(1, math.index!, math.index! + math[0].length)
  }
  const quoteClosers: Readonly<Record<string, string>> = {
    '"': '"',
    "'": "'",
    '“': '”',
    '„': '“”',
    '‘': '’',
    '«': '»',
    '‹': '›',
    '»': '«',
    '›': '‹',
  }
  for (let start = 0; start < text.length; start++) {
    const opening = text[start]!
    const closers = quoteClosers[opening]
    if (!closers || mask[start] || escaped(start)) continue
    // Apostrophes and inch marks embedded in words/numbers are not opening
    // quotation marks. Matched code/link spans have already been protected.
    if ((opening === "'" || opening === '"') && /[\p{L}\p{N}]/u.test(text[start - 1] ?? ''))
      continue
    let end = start + 1
    for (; end < text.length; end++) {
      if (/^\r?\n[ \t]*\r?\n/.test(text.slice(end, end + 16))) break
      if (
        !mask[end] &&
        !escaped(end) &&
        closers.includes(text[end]!) &&
        !((opening === "'" || opening === '"') && /[\p{L}\p{N}]/u.test(text[end + 1] ?? ''))
      )
        break
    }
    if (end < text.length && closers.includes(text[end]!)) mask.fill(1, start, end + 1)
    // An unmatched quotation makes plain/literal placement uncertain. Matched
    // literals remain intact; other labels in this record cannot be cleaned.
    else ambiguous.fill(1)
    start = end
  }
  const horizontal = (char: string | undefined): boolean =>
    char !== undefined && /[\t\p{Zs}]/u.test(char)
  const boundary = (char: string | undefined): boolean =>
    char === undefined || /[\s.,;:!?]/u.test(char)
  const removals: Array<{ start: number; end: number }> = []
  for (const candidate of text.matchAll(/\([ \t]*doc[ \t]*:/giu)) {
    const start = candidate.index!
    if (mask[start] || escaped(start)) continue
    if (ambiguous[start]) return reject('source_label_ambiguous')
    const end = text.indexOf(')', start) + 1
    if (!end || /[\r\n]/u.test(text.slice(start, end))) return reject('source_label_malformed')
    const label =
      /^\([ \t]*doc[ \t]*:[ \t]*([1-9]\d*)[ \t]*(?::|,[ \t]*chunk[ \t]*:)[ \t]*([1-9]\d*)[ \t]*\)$/iu.exec(
        text.slice(start, end),
      )
    if (!label || !validId(Number(label[1])) || !validId(Number(label[2])))
      return reject('source_label_malformed')
    if (!recordSources.has(`${label[1]}:${label[2]}`)) return reject('source_label_unattached')
    // Do not alter Markdown delimiters, nested parentheses or adjacent words.
    // Such placements have no unambiguous plain-prose cleanup.
    if (!boundary(text[start - 1]) || !boundary(text[end])) return reject('source_label_placement')
    if (mask.subarray(start, end).some(Boolean)) return reject('source_label_literal_overlap')
    let removeStart = start
    let removeEnd = end
    let afterSpaces = end
    while (horizontal(text[afterSpaces])) afterSpaces++
    if (horizontal(text[start - 1]) && /[\r\n]/u.test(text[afterSpaces] ?? '')) {
      // Trailing spaces after the label already encode the author's hard/soft
      // Markdown break. Keep them; spaces before the label must not become one.
      while (horizontal(text[removeStart - 1])) removeStart--
    } else if (horizontal(text[start - 1]) && horizontal(text[end])) {
      while (horizontal(text[removeEnd])) removeEnd++
    } else if (
      horizontal(text[start - 1]) &&
      (text[end] === undefined || /[.,;:!?]/u.test(text[end]!))
    ) {
      while (horizontal(text[removeStart - 1])) removeStart--
    } else if (start === 0 && horizontal(text[end])) {
      while (horizontal(text[removeEnd])) removeEnd++
    }
    removals.push({ start: removeStart, end: removeEnd })
  }
  let cleaned = ''
  let cursor = 0
  for (const removal of removals) {
    cleaned += text.slice(cursor, Math.max(cursor, removal.start))
    cursor = Math.max(cursor, removal.end)
  }
  return cleaned + text.slice(cursor)
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

/** Citation-shaped prose, including invalid IDs, for fail-closed validation.
 * Markdown literals remain excluded just as they are in the visible reader. */
export function findCitationAttempts(text: string): CitationMatch[] {
  return rawMatches(text)
}

/** Citation-looking prose, including grouped/dangling or otherwise malformed
 * syntax. Use when only program-generated markers are allowed; do not repair
 * model text or infer identities. Markdown literals use the same protection as
 * ordinary marker discovery and remain unchanged. */
export function hasUnmaskedCitationSyntax(text: string): boolean {
  const mask = literalMask(text)
  for (const match of text.matchAll(/\[doc\s*:/giu)) {
    if (!mask[match.index!]) return true
  }
  return false
}

/** Source-linked generated records support Markdown, not active raw HTML.
 * Exclude code, links, comments and escaped '<' characters without confusing a
 * plain numerical comparison with a tag. Closed HTML comments stay literal;
 * an unclosed comment is caught by final marker visibility validation. */
export function hasActiveHtmlSyntax(text: string): boolean {
  const mask = literalMask(text, false)
  // CommonMark HTML flow conditions 1 and 6 also accept unfinished tag names
  // before whitespace/end. Appending a source marker must not complete such a
  // raw block opener. This is the block/raw-name set used by our micromark
  // reader, not a guess that every compact comparison (x<y) is HTML.
  const blockNames =
    'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul|pre|script|style|textarea'
  const html = new RegExp(`<(?:/?[A-Za-z][^<>]*>|/?(?:${blockNames})(?=[\\s/>]|$)|[!?])`, 'giu')
  for (const match of text.matchAll(html)) {
    if (mask[match.index!]) continue
    let backslashes = 0
    for (let index = match.index! - 1; index >= 0 && text[index] === '\\'; index--) backslashes++
    if (!(backslashes % 2)) return true
  }
  return false
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
