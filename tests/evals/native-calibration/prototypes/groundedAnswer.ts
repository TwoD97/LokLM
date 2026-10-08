import { findCitationMatches, type CitationMatch } from '../../../../src/shared/citationMarkers'
import type { RetrievalHit } from '../../../../src/shared/documents'

type SourcePassage = Pick<RetrievalHit, 'document_id' | 'chunk_id' | 'text'>

/** Model-authored proposal. Valid structure/quote membership does not establish
 * semantic support, scope, arithmetic correctness, or authority. */
export interface GroundedAnswer {
  evidence: Array<{ source: string; quote: string }>
  comparison: string
  status: 'answered' | 'unresolved' | 'missing'
  claims: Array<{ text: string; sources: string[] }>
}

export interface GroundedEvidenceSpan {
  source: string
  documentId: number
  chunkId: number
  /** First exact occurrence, measured in original UTF-16 code units. */
  start: number
  end: number
  /** The quote occurs elsewhere too; do not imply a uniquely selected location. */
  ambiguous: boolean
}
export interface ParsedGroundedAnswer extends GroundedAnswer {
  /** Program-derived metadata, never accepted as additional model JSON fields. */
  evidenceSpans: GroundedEvidenceSpan[]
}

export const GROUNDED_ANSWER_LIMITS = Object.freeze({
  rawChars: 12_000,
  passages: 32,
  passageChars: 64_000,
  totalPassageChars: 256_000,
  evidence: 4,
  quoteChars: 200,
  comparisonChars: 240,
  claims: 4,
  claimChars: 600,
  claimSources: 4,
  renderedChars: 6_000,
})

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const hasKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
// JSON Schema string lengths count decoded Unicode code points, while source
// offsets and raw/aggregate storage limits intentionally use UTF-16 code units.
const textLength = (text: string): number => Array.from(text).length

function sourceIds(source: unknown): { documentId: number; chunkId: number } | null {
  if (typeof source !== 'string' || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(source)) return null
  const [documentId, chunkId] = source.split(':').map(Number)
  return Number.isSafeInteger(documentId) && Number.isSafeInteger(chunkId)
    ? { documentId: documentId!, chunkId: chunkId! }
    : null
}

// Source quotes can legitimately contain marker-like text, but model-authored
// claims/comparisons may not inject citations or source-navigation destinations.
// Include HTML forms that Markdown could decode into a #cite- destination.
const embeddedCitation = /\[\s*doc\s*:|(?:#|&num;|&#(?:x0*23|0*35);?)cite-/iu

/** Called only after JSON.parse succeeds, so strings and nesting are complete.
 * Inspect original keys before JSON's last-value-wins behavior can hide repeats,
 * including escaped spellings of the same property name. No recursive walk. */
function duplicateKeys(raw: string): boolean {
  const stack: Array<Set<string> | null> = []
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (char === '{') stack.push(new Set())
    else if (char === '[') stack.push(null)
    else if (char === '}' || char === ']') stack.pop()
    else if (char === '"') {
      const start = i++
      while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1
      let after = i + 1
      while (after < raw.length && /\s/u.test(raw[after]!)) after++
      if (raw[after] !== ':') continue
      const keys = stack.at(-1)
      if (!keys) continue
      const key = JSON.parse(raw.slice(start, i + 1)) as string
      if (keys.has(key)) return true
      keys.add(key)
    }
  }
  return false
}

/** Shared wire checks, also used by the renderer so later object mutation cannot
 * silently inject IDs, markers or oversized text into program-built citations. */
function validShape(value: unknown, parsed = false): value is GroundedAnswer {
  if (
    !object(value) ||
    !hasKeys(value, [
      'evidence',
      'comparison',
      'status',
      'claims',
      ...(parsed ? ['evidenceSpans'] : []),
    ])
  )
    return false
  if (
    typeof value.status !== 'string' ||
    !['answered', 'unresolved', 'missing'].includes(value.status) ||
    typeof value.comparison !== 'string' ||
    !value.comparison.trim() ||
    textLength(value.comparison) > GROUNDED_ANSWER_LIMITS.comparisonChars ||
    embeddedCitation.test(value.comparison) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.length ||
    value.evidence.length > GROUNDED_ANSWER_LIMITS.evidence ||
    !Array.isArray(value.claims) ||
    !value.claims.length ||
    value.claims.length > GROUNDED_ANSWER_LIMITS.claims
  )
    return false
  const selected = new Set<string>()
  const selectedQuotes = new Set<string>()
  for (const evidence of value.evidence) {
    if (
      !object(evidence) ||
      !hasKeys(evidence, ['source', 'quote']) ||
      !sourceIds(evidence.source) ||
      typeof evidence.quote !== 'string' ||
      !evidence.quote.trim() ||
      textLength(evidence.quote) > GROUNDED_ANSWER_LIMITS.quoteChars
    )
      return false
    const pair = JSON.stringify([evidence.source, evidence.quote])
    if (selectedQuotes.has(pair)) return false
    selectedQuotes.add(pair)
    selected.add(evidence.source as string)
  }
  for (const claim of value.claims) {
    if (
      !object(claim) ||
      !hasKeys(claim, ['text', 'sources']) ||
      typeof claim.text !== 'string' ||
      !claim.text.trim() ||
      textLength(claim.text) > GROUNDED_ANSWER_LIMITS.claimChars ||
      embeddedCitation.test(claim.text) ||
      !Array.isArray(claim.sources) ||
      claim.sources.length > GROUNDED_ANSWER_LIMITS.claimSources ||
      new Set(claim.sources).size !== claim.sources.length ||
      claim.sources.some((source) => typeof source !== 'string' || !selected.has(source)) ||
      (value.status !== 'missing' && !claim.sources.length)
    )
      return false
  }
  return true
}

/** Parse structural quotation membership only. Every malformed/unbounded raw
 * proposal returns null; never repair quotes or select a different source. */
export function parseGroundedAnswer(
  raw: string,
  passages: readonly SourcePassage[],
): ParsedGroundedAnswer | null {
  if (
    typeof raw !== 'string' ||
    raw.length > GROUNDED_ANSWER_LIMITS.rawChars ||
    !Array.isArray(passages) ||
    passages.length > GROUNDED_ANSWER_LIMITS.passages
  )
    return null
  let value: unknown
  try {
    value = JSON.parse(raw)
    if (duplicateKeys(raw)) return null
  } catch {
    return null
  }
  if (!validShape(value)) return null
  let totalChars = 0
  const sources = new Map<string, SourcePassage>()
  for (const passage of passages) {
    if (!object(passage) || typeof passage.text !== 'string') return null
    if (
      typeof passage.document_id !== 'number' ||
      typeof passage.chunk_id !== 'number' ||
      !Number.isSafeInteger(passage.document_id) ||
      passage.document_id <= 0 ||
      !Number.isSafeInteger(passage.chunk_id) ||
      passage.chunk_id <= 0 ||
      passage.text.length > GROUNDED_ANSWER_LIMITS.passageChars
    )
      return null
    const key = `${passage.document_id}:${passage.chunk_id}`
    if (sources.has(key)) return null
    totalChars += passage.text.length
    if (totalChars > GROUNDED_ANSWER_LIMITS.totalPassageChars) return null
    sources.set(key, {
      document_id: passage.document_id,
      chunk_id: passage.chunk_id,
      text: passage.text,
    })
  }
  const evidenceSpans: GroundedEvidenceSpan[] = []
  for (const evidence of value.evidence) {
    const passage = sources.get(evidence.source)
    if (!passage) return null
    const start = passage.text.indexOf(evidence.quote)
    if (start < 0) return null
    evidenceSpans.push({
      source: evidence.source,
      documentId: passage.document_id,
      chunkId: passage.chunk_id,
      start,
      end: start + evidence.quote.length,
      ambiguous: passage.text.indexOf(evidence.quote, start + 1) >= 0,
    })
  }
  const result: ParsedGroundedAnswer = { ...value, evidenceSpans }
  return renderGroundedAnswer(result) === null ? null : result
}

/** Attach only the proposal's selected valid source IDs. This proves marker
 * integrity, not that a selected passage semantically supports its claim.
 * Reject Markdown that makes an appended marker disappear or change identity
 * under the same scanner used by the chat renderer. */
export function renderGroundedAnswer(answer: GroundedAnswer): string | null {
  if (!validShape(answer, object(answer) && Object.hasOwn(answer, 'evidenceSpans'))) return null
  let rendered = ''
  const expected: CitationMatch[] = []
  for (const claim of answer.claims) {
    if (rendered) rendered += ' '
    rendered += claim.text
    for (const source of claim.sources) {
      const ids = sourceIds(source)!
      const marker = `[doc:${ids.documentId}, chunk:${ids.chunkId}]`
      rendered += ' '
      const start = rendered.length
      rendered += marker
      expected.push({ ...ids, start, end: rendered.length })
    }
  }
  if (rendered.length > GROUNDED_ANSWER_LIMITS.renderedChars) return null
  const actual = findCitationMatches(rendered)
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
    return null
  return rendered
}
