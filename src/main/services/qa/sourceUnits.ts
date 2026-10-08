/** Original, complete text units for compact source display. Membership and
 * sentence boundaries do not establish relevance, entailment or authority:
 * a following sentence may contain a qualification that must also be selected. */
export type SourceUnitPassage = {
  document_id: number
  chunk_id: number
  document_title?: string | null
  text: string
}
export type SourceUnit = Readonly<{
  id: string
  source: string
  start: number
  end: number
  text: string
}>
export type SourceUnitCatalogFailure = 'source_bounds' | 'unit_bounds' | 'segmentation'
export const SOURCE_UNIT_LIMITS = Object.freeze({
  sources: 32,
  sourceChars: 64_000,
  totalSourceChars: 256_000,
  units: 256,
})

type Line = { start: number; end: number; text: string }
function linesOf(text: string): Line[] {
  return [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)]
    .filter((match) => match[0].length > 0)
    .map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }))
}
const blank = (line: Line): boolean => !line.text.trim()
const fence = (line: Line): RegExpMatchArray | null => line.text.match(/^ {0,3}(`{3,}|~{3,})/u)
const structured = (text: string): boolean =>
  /^(?: {0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s|(?:`{3,}|~{3,})|\|)| {4}|\t)/mu.test(text) ||
  text.includes('|') ||
  /<|\$\$/u.test(text)
// Intl sentence boundaries are not a full language parser. Keep an entire
// paragraph when common abbreviations/initials could leave a fragment such as
// "Dr." without its subject; no word or qualifier is removed to make it short.
const ambiguousAbbreviation = (text: string): boolean =>
  /\b(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|e\.g|i\.e|z\.\s*B|d\.\s*h)\.|(?:^|\s)\p{Lu}\.(?:\s|$)/u.test(
    text,
  )

/** Paragraph boundaries never split fenced code. List/quote/indented blocks
 * include following indented/list/quote paragraphs, preserving loose-list
 * continuations. Structured blocks are not sentence-tokenized. */
function blocksOf(text: string): Array<{ start: number; end: number; structured: boolean }> {
  const lines = linesOf(text)
  const blocks: Array<{ start: number; end: number; structured: boolean }> = []
  let index = 0
  while (index < lines.length) {
    if (blank(lines[index]!)) {
      index++
      continue
    }
    const first = index
    let open: { character: string; length: number } | null = null
    let blockStructured = false
    while (index < lines.length) {
      const line = lines[index]!
      const delimiter = fence(line)
      if (delimiter) {
        blockStructured = true
        const run = delimiter[1]!
        if (!open) open = { character: run[0]!, length: run.length }
        else if (
          run[0] === open.character &&
          run.length >= open.length &&
          line.text.slice(delimiter[0].length).trim() === ''
        )
          open = null
      }
      if (!open && blank(line)) {
        // A list's indented paragraph or a continuing quote is part of the
        // same complete block, even across an empty line.
        let next = index + 1
        while (next < lines.length && blank(lines[next]!)) next++
        const startedContainer = /^(?: {0,3}(?:>|[-+*]\s|\d+[.)]\s)| {4}|\t)/u.test(
          lines[first]!.text,
        )
        if (
          startedContainer &&
          next < lines.length &&
          /^(?:\s|>|[-+*]\s|\d+[.)]\s)/u.test(lines[next]!.text)
        ) {
          index = next
          continue
        }
        break
      }
      index++
    }
    const start = lines[first]!.start
    const end = lines[index - 1]!.end
    blocks.push({ start, end, structured: blockStructured || structured(text.slice(start, end)) })
  }
  return blocks
}

export function createSourceUnitCatalog(input: readonly SourceUnitPassage[]):
  | { ok: false; reason: SourceUnitCatalogFailure }
  | {
      ok: true
      units: readonly SourceUnit[]
      get: (id: string) => SourceUnit | undefined
      promptSourceText: (documentId: number, chunkId: number) => string
    } {
  const fail = (reason: SourceUnitCatalogFailure) => ({ ok: false as const, reason })
  if (!input.length || input.length > SOURCE_UNIT_LIMITS.sources) return fail('source_bounds')
  const sources = new Map<string, string>()
  const codeSources = new Set<string>()
  let total = 0
  for (const passage of input) {
    const id = `${passage.document_id}:${passage.chunk_id}`
    if (
      !Number.isSafeInteger(passage.document_id) ||
      passage.document_id <= 0 ||
      !Number.isSafeInteger(passage.chunk_id) ||
      passage.chunk_id <= 0 ||
      sources.has(id) ||
      typeof passage.text !== 'string' ||
      !passage.text.trim() ||
      passage.text.length > SOURCE_UNIT_LIMITS.sourceChars
    )
      return fail('source_bounds')
    total += passage.text.length
    if (total > SOURCE_UNIT_LIMITS.totalSourceChars) return fail('source_bounds')
    sources.set(id, passage.text)
    if (
      /\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|c|cc|cpp|h|cs|sh|ps1|sql|json|ya?ml|toml|xml|html|css)$/iu.test(
        passage.document_title ?? '',
      )
    )
      codeSources.add(id)
  }
  const units: SourceUnit[] = []
  const annotated = new Map<string, string>()
  const unitBoundExceeded = Symbol('source-unit-bound')
  try {
    // A fixed locale avoids dependence on the user's operating-system locale.
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
    for (const [source, text] of sources) {
      const sourceUnits: SourceUnit[] = []
      const add = (start: number, end: number, preserveWhitespace = false): void => {
        if (!preserveWhitespace) {
          while (start < end && /\s/u.test(text[start]!)) start++
          while (end > start && /\s/u.test(text[end - 1]!)) end--
        }
        if (start === end) return
        if (units.length >= SOURCE_UNIT_LIMITS.units) throw unitBoundExceeded
        const unit = Object.freeze({
          id: `U${units.length + 1}`,
          source,
          start,
          end,
          text: text.slice(start, end),
        })
        units.push(unit)
        sourceUnits.push(unit)
      }
      const blocks = codeSources.has(source)
        ? [{ start: 0, end: text.length, structured: true }]
        : blocksOf(text)
      for (const block of blocks) {
        if (block.structured || ambiguousAbbreviation(text.slice(block.start, block.end)))
          add(block.start, block.end, true)
        else
          for (const sentence of segmenter.segment(text.slice(block.start, block.end))) {
            add(
              block.start + sentence.index,
              block.start + sentence.index + sentence.segment.length,
            )
          }
      }
      // Exact original bytes plus inserted labels. No source characters are
      // replaced, repeated, normalized or excluded from the prompt.
      let cursor = 0
      let labelled = ''
      for (const unit of sourceUnits) {
        if (/\S/u.test(text.slice(cursor, unit.start))) return fail('segmentation')
        labelled += text.slice(cursor, unit.start) + `[${unit.id}] ` + unit.text
        cursor = unit.end
      }
      if (/\S/u.test(text.slice(cursor))) return fail('segmentation')
      labelled += text.slice(cursor)
      annotated.set(source, labelled)
    }
  } catch (error) {
    return fail(error === unitBoundExceeded ? 'unit_bounds' : 'segmentation')
  }
  if (!units.length) return fail('segmentation')
  const lookup = new Map(units.map((unit) => [unit.id, unit]))
  return Object.freeze({
    ok: true as const,
    units: Object.freeze(units),
    get: (id: string) => lookup.get(id),
    promptSourceText(documentId: number, chunkId: number): string {
      const text = annotated.get(`${documentId}:${chunkId}`)
      if (text === undefined) throw new Error('Unknown source unit passage')
      return text
    },
  })
}
