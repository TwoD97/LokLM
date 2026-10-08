import {
  findCitationMatches,
  removeRedundantSourceLabels,
  hasActiveHtmlSyntax,
  hasUnmaskedCitationSyntax,
  type CitationMatch,
  type SourceLabelRejection,
} from './citationMarkers'

const MAX_ANSWER_CHARS = 32_000
// Match the ordinary schema's raw-reference bound, before removing repeats.
const MAX_RECORD_SOURCES = 32
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Fixed structural diagnostics only. Never include model/source text or IDs. */
export type SourceLinkedAnswerRejection =
  | SourceLabelRejection
  | 'record_shape'
  | 'sources_shape'
  | 'source_unknown'
  | 'source_duplicate' // Retained for historical diagnostic consumers.
  | 'source_invalid'
  | 'text_bounds'
  | 'text_empty'
  | 'source_label' // Retained for historical diagnostic consumers and fallback.
  | 'citation_syntax'
  | 'html_syntax'
  | 'reserved_href'
  | 'render_bounds'
  | 'citation_placement'

/** Render one source attachment per model-authored record. A record can contain
 * arbitrary Markdown: this is not a one-paragraph parser or a claim verifier.
 * Source choice and support for every assertion still require semantic judgment.
 * Only supplied identities and visible program-generated markers are enforced. */
export function renderSourceLinkedAnswer(
  blocks: unknown,
  suppliedSources: ReadonlySet<string>,
  maxAnswerChars: number,
  onRejectDetail?: (reason: SourceLinkedAnswerRejection) => void,
): string | null {
  const reject = (reason: SourceLinkedAnswerRejection): null => {
    try {
      onRejectDetail?.(reason)
    } catch {
      // Diagnostics must never change validation or expose the rejected body.
    }
    return null
  }
  if (
    !Number.isSafeInteger(maxAnswerChars) ||
    maxAnswerChars < 1 ||
    maxAnswerChars > MAX_ANSWER_CHARS
  )
    return reject('text_bounds')
  if (
    !Array.isArray(blocks) ||
    !blocks.length ||
    // Every record consumes at least one text character. Bound admission without
    // a small claim-count ceiling that would truncate detailed answers.
    blocks.length > maxAnswerChars
  )
    return reject('record_shape')
  let markdown = ''
  let codePoints = 0
  let originalBodyCodePoints = 0
  const expected: CitationMatch[] = []
  for (const block of blocks) {
    if (
      !object(block) ||
      Object.keys(block).length !== 2 ||
      !Object.hasOwn(block, 'text') ||
      !Object.hasOwn(block, 'sources') ||
      typeof block.text !== 'string'
    )
      return reject('record_shape')
    if (block.text.length > maxAnswerChars * 2) return reject('text_bounds')
    if (
      !Array.isArray(block.sources) ||
      !block.sources.length ||
      block.sources.length > MAX_RECORD_SOURCES
    )
      return reject('sources_shape')
    const sources: Array<{ documentId: number; chunkId: number }> = []
    const seen = new Set<string>()
    for (const source of block.sources) {
      if (typeof source !== 'string') return reject('sources_shape')
      if (!suppliedSources.has(source)) return reject('source_unknown')
      const ids = /^([1-9]\d*):([1-9]\d*)$/.exec(source)
      if (!ids || ids[0] !== source) return reject('source_invalid')
      const documentId = Number(ids[1])
      const chunkId = Number(ids[2])
      if (!Number.isSafeInteger(documentId) || !Number.isSafeInteger(chunkId))
        return reject('source_invalid')
      // Validate every raw reference, then keep each supplied identity once in
      // first-occurrence order. Other records retain their own attachments.
      if (seen.has(source)) continue
      seen.add(source)
      sources.push({ documentId, chunkId })
    }
    // Validate the untouched body before presentation cleanup, so repeated
    // removable labels cannot bypass the caller's aggregate generation bound.
    const original = block.text.trimEnd()
    originalBodyCodePoints += Array.from(original).length
    if (originalBodyCodePoints > maxAnswerChars) return reject('text_bounds')
    let labelRejection: SourceLabelRejection | undefined
    const cleaned = removeRedundantSourceLabels(original, seen, (reason) => {
      labelRejection = reason
    })
    if (cleaned === null) return reject(labelRejection ?? 'source_label')
    const text = cleaned.trimEnd()
    if (!text.trim()) return reject('text_empty')
    if (hasUnmaskedCitationSyntax(text)) return reject('citation_syntax')
    if (hasActiveHtmlSyntax(text)) return reject('html_syntax')
    if (/#cite-/iu.test(text)) return reject('reserved_href')
    const prefix = markdown ? '\n\n' : ''
    // Keep ordinary prose citations inline. For multiline Markdown, a separate
    // paragraph cannot corrupt a closing code fence, table row or list item.
    const separator = /[\r\n]|^(?: {4}|\t)/u.test(text) ? '\n\n' : ' '
    const body = prefix + text + separator
    codePoints += Array.from(body).length
    if (codePoints > maxAnswerChars) return reject('render_bounds')
    markdown += body
    for (const [index, source] of sources.entries()) {
      const marker = `${index ? ' ' : ''}[doc:${source.documentId}, chunk:${source.chunkId}]`
      codePoints += marker.length
      if (codePoints > maxAnswerChars) return reject('render_bounds')
      const start = markdown.length + (index ? 1 : 0)
      markdown += marker
      expected.push({ ...source, start, end: markdown.length })
    }
  }
  // Model text must not inject a marker or absorb one into a code/link/HTML
  // literal, including syntax assembled across adjacent answer records.
  const actual = findCitationMatches(markdown)
  if (
    actual.length !== expected.length ||
    actual.some((marker, index) => {
      const wanted = expected[index]!
      return (
        marker.documentId !== wanted.documentId ||
        marker.chunkId !== wanted.chunkId ||
        marker.start !== wanted.start ||
        marker.end !== wanted.end
      )
    })
  )
    return reject('citation_placement')
  return markdown
}
