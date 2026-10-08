/** A bounded source display, not a semantic verifier. A structurally valid
 * outcome or passage selection can still be wrong or incomplete. */
import type { RetrievalHit } from '../../../shared/documents'
import { findCitationMatches, type CitationMatch } from '../../../shared/citationMarkers'
import { escapeSourceMarkdown, sourceQuoteMarkdown } from '../../../shared/sourceQuoteMarkdown'
import {
  renderSourceLinkedAnswer,
  type SourceLinkedAnswerRejection,
} from '../../../shared/sourceLinkedAnswer'
import { sourceCalculationAnnotations } from './sourceCalculations'
import { sourceQuantityAnnotations } from './sourceQuantities'
import { requestsSingleSentence } from './answerFormat'
import { conflictSummarySchema, renderConflictSummary } from './conflictSummary'

type Passage = Pick<RetrievalHit, 'document_id' | 'chunk_id' | 'document_title' | 'text'>
export type ComparisonDerivation = {
  id: string
  kind: 'quantity' | 'code'
  source: string
  start: number
  end: number
  original: string
  expression: string
}
export type ComparisonSourceSpan = {
  source: string
  start: number
  end: number
  text: string
  ambiguous: boolean
}
export type ParsedComparisonAnswer = {
  mode: 'answered' | 'comparison'
  outcome?: 'compatible' | 'unresolved' | 'insufficient'
  answer: string
  /** Exact source passages or fragments only; generated answers have no spans. */
  spans: ComparisonSourceSpan[]
  /** Original source text displayed, without model-authored quotations. */
  displaySpans: ComparisonSourceSpan[]
  /** Program-produced values only; never accepted from the model. */
  derivations: ComparisonDerivation[]
}
export type ComparisonRejection =
  | 'bounds'
  | 'json'
  | 'envelope'
  | 'answer'
  | 'comparison'
  | 'source'
  | 'context'
  | 'render'
  | 'citations'
export type OrdinaryAnswerRejection = SourceLinkedAnswerRejection | 'source_order'
/** Fixed comparison diagnostics; no rejected values or source details.
 * Historical exact-fragment categories remain readable in persisted evaluations. */
export type ComparisonAnswerRejectionDetail =
  | 'comparison_shape'
  | 'summary_shape'
  | 'summary_display'
  | 'evidence_shape'
  | 'evidence_source'
  | 'title_display'
  | 'label_display'
  | 'label_missing'
  | 'label_boundary'
  | 'excerpt_display'
  | 'excerpt_missing'
  | 'excerpt_boundary'
  | 'render_bound'
  | 'shared_render'
  | 'render_mismatch'
const LIMITS = {
  sources: 32,
  sourceChars: 64_000,
  totalSourceChars: 256_000,
  rawChars: 256_000,
  comparisonSources: 4,
  recordSources: 32,
  summaryRenderChars: 512,
  references: 48,
  renderedChars: 32_000,
}
export const COMPARISON_ANSWER_VERSION = 'typed-comparison-v32'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const hasKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

/** After JSON.parse, inspect original keys so escaped duplicates cannot overwrite. */
function hasDuplicateKeys(raw: string): boolean {
  const stack: Array<Set<string> | null> = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') stack.push(new Set())
    else if (raw[i] === '[') stack.push(null)
    else if (raw[i] === '}' || raw[i] === ']') stack.pop()
    else if (raw[i] === '"') {
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

/** Build a per-prompt immutable catalog, not an extra inference pass. All input
 * passages remain in the caller's checked prompt; this catalog never selects or
 * removes sources. If limits fail, decline the complete comparison plan. */
export function createComparisonAnswerPlan(question: string, input: readonly Passage[]) {
  if (!input.length || input.length > LIMITS.sources) return null
  const sources = new Map<string, Passage>()
  let total = 0
  for (const source of input) {
    if (
      !Number.isSafeInteger(source.document_id) ||
      source.document_id <= 0 ||
      !Number.isSafeInteger(source.chunk_id) ||
      source.chunk_id <= 0 ||
      typeof source.text !== 'string' ||
      !source.text.trim() ||
      source.text.length > LIMITS.sourceChars
    )
      return null
    total += source.text.length
    if (total > LIMITS.totalSourceChars) return null
    const key = `${source.document_id}:${source.chunk_id}`
    if (sources.has(key)) return null
    sources.set(key, { ...source })
  }
  const passages = [...sources.values()]
  const comparisonMode = requestsSingleSentence(question) ? ('summary' as const) : ('full' as const)
  const quantities = sourceQuantityAnnotations(passages).quantities
  const calculations = sourceCalculationAnnotations(question, passages).calculations
  const references: ComparisonDerivation[] = [
    ...quantities.map(
      (quantity): ComparisonDerivation => ({
        id: quantity.id,
        kind: 'quantity',
        source: `${quantity.documentId}:${quantity.chunkId}`,
        start: quantity.start,
        end: quantity.end,
        original: quantity.text,
        expression: `${quantity.text} = ${quantity.normalized.value} ${quantity.normalized.unit}`,
      }),
    ),
    ...calculations.map(
      (calculation, index): ComparisonDerivation => ({
        id: `C${index + 1}`,
        kind: 'code',
        source: `${calculation.documentId}:${calculation.chunkId}`,
        start: calculation.start,
        end: calculation.end,
        original: calculation.source,
        expression: `${calculation.call} = ${Object.is(calculation.result, -0) ? '-0' : String(calculation.result)}`,
      }),
    ),
  ]
  if (
    references.some(
      (reference) =>
        sources.get(reference.source)?.text.slice(reference.start, reference.end) !==
        reference.original,
    )
  )
    return null
  if (references.length > LIMITS.references) return null
  const ids = [...sources.keys()]
  const comparisonSchema = (outcomes: string[], minimumSources: number) => ({
    type: 'object',
    properties: {
      resolution: { const: 'comparison' },
      sources: {
        type: 'array',
        minItems: minimumSources,
        maxItems: LIMITS.comparisonSources,
        items: { enum: ids },
      },
      outcome: { enum: outcomes },
    },
    required: ['resolution', 'sources', 'outcome'],
    additionalProperties: false,
  })
  // Retained plan field now describes the complete rendered summary allowance;
  // there is no unrestricted generated sentence body in the summary contract.
  const summaryMaxCodePoints = comparisonMode === 'summary' ? LIMITS.summaryRenderChars : null
  const summarySchema = {
    type: 'object',
    properties: {
      resolution: { const: 'comparison' },
      summary: conflictSummarySchema(ids),
      outcome: { const: 'unresolved' },
    },
    required: ['resolution', 'summary', 'outcome'],
    additionalProperties: false,
  }
  const schema = {
    type: 'object',
    properties: {
      check: { type: 'string', minLength: 1, maxLength: 120 },
      result: {
        oneOf: [
          {
            type: 'object',
            properties: {
              resolution: { const: 'answered' },
              blocks: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', minLength: 1 },
                    sources: {
                      type: 'array',
                      minItems: 1,
                      maxItems: LIMITS.recordSources,
                      items: { enum: ids },
                    },
                  },
                  required: ['text', 'sources'],
                  additionalProperties: false,
                },
              },
            },
            required: ['resolution', 'blocks'],
            additionalProperties: false,
          },
          ...(comparisonMode === 'summary'
            ? [summarySchema]
            : [
                comparisonSchema(['compatible', 'unresolved'], 1),
                comparisonSchema(['insufficient'], 1),
              ]),
        ],
      },
    },
    required: ['check', 'result'],
    additionalProperties: false,
  }
  function parse(
    raw: string,
    language: 'en' | 'de',
    maxAnswerChars: number,
    onReject?: (reason: ComparisonRejection) => void,
    onRejectDetail?: (reason: OrdinaryAnswerRejection) => void,
    onComparisonRejectDetail?: (reason: ComparisonAnswerRejectionDetail) => void,
  ): ParsedComparisonAnswer | null {
    // Diagnostics expose only a fixed structural category, never source text,
    // rejected content or raw JSON.
    const reject = (reason: ComparisonRejection): null => {
      onReject?.(reason)
      return null
    }
    if (!Number.isSafeInteger(maxAnswerChars) || maxAnswerChars < 1 || maxAnswerChars > 32_000)
      return reject('bounds')
    if (typeof raw !== 'string' || raw.length > LIMITS.rawChars) return reject('bounds')
    let value: unknown
    try {
      value = JSON.parse(raw)
      if (hasDuplicateKeys(raw)) return reject('json')
    } catch {
      return reject('json')
    }
    if (
      !object(value) ||
      !hasKeys(value, ['check', 'result']) ||
      Object.keys(value)[0] !== 'check' ||
      typeof value.check !== 'string' ||
      !value.check.trim() ||
      Array.from(value.check).length > 120 ||
      !object(value.result)
    )
      return reject('envelope')
    const result = value.result
    if (result.resolution === 'answered') {
      const rejectOrdinary = (reason: OrdinaryAnswerRejection): null => {
        try {
          onRejectDetail?.(reason)
        } catch {
          // A diagnostic sink cannot alter admission or expose private text.
        }
        return reject('answer')
      }
      if (!hasKeys(result, ['resolution', 'blocks'])) return rejectOrdinary('record_shape')
      if (
        !Array.isArray(result.blocks) ||
        !result.blocks.length ||
        result.blocks.length > maxAnswerChars
      )
        return rejectOrdinary('record_shape')
      for (const block of result.blocks) {
        if (!object(block) || !hasKeys(block, ['sources', 'text']))
          return rejectOrdinary('record_shape')
        if (Object.keys(block)[0] !== 'text') return rejectOrdinary('source_order')
      }
      // Enforce source membership, uniqueness and visible marker placement in
      // the shared renderer. This attaches passages; it does not verify claims.
      const answer = renderSourceLinkedAnswer(
        result.blocks,
        new Set(ids),
        maxAnswerChars,
        onRejectDetail,
      )
      return answer === null
        ? reject('answer')
        : { mode: 'answered', answer, spans: [], displaySpans: [], derivations: [] }
    }
    if (comparisonMode === 'summary') {
      const rejectSummary = (
        broad: ComparisonRejection,
        detail: ComparisonAnswerRejectionDetail,
      ): null => {
        try {
          onComparisonRejectDetail?.(detail)
        } catch {
          // Diagnostics cannot affect admission or disclose generated content.
        }
        return reject(broad)
      }
      if (
        result.resolution !== 'comparison' ||
        !hasKeys(result, ['resolution', 'summary', 'outcome']) ||
        Object.keys(result).join(',') !== 'resolution,summary,outcome' ||
        result.outcome !== 'unresolved'
      )
        return rejectSummary('comparison', 'comparison_shape')
      const rejection: { detail: ComparisonAnswerRejectionDetail } = { detail: 'summary_shape' }
      const summary = renderConflictSummary(
        result.summary,
        sources,
        language,
        maxAnswerChars,
        (reason) => {
          rejection.detail = reason
        },
      )
      if (!summary)
        return rejectSummary(
          rejection.detail === 'render_bound'
            ? 'answer'
            : rejection.detail === 'render_mismatch'
              ? 'citations'
              : 'comparison',
          rejection.detail,
        )
      return {
        mode: 'comparison',
        outcome: 'unresolved',
        ...summary,
        derivations: [],
      }
    }
    const selected = result.sources
    if (
      result.resolution !== 'comparison' ||
      !hasKeys(result, ['resolution', 'outcome', 'sources']) ||
      (result.outcome !== 'compatible' &&
        result.outcome !== 'unresolved' &&
        result.outcome !== 'insufficient') ||
      !Array.isArray(selected) ||
      selected.length < 1 ||
      selected.length > LIMITS.comparisonSources
    )
      return reject('comparison')
    const spans: ComparisonSourceSpan[] = []
    const seen = new Set<string>()
    for (const source of selected) {
      if (typeof source !== 'string' || seen.has(source)) return reject('source')
      seen.add(source)
      if (!sources.has(source)) return reject('source')
      const passage = sources.get(source)!
      spans.push({
        source,
        start: 0,
        end: passage.text.length,
        text: passage.text,
        ambiguous: false,
      })
    }
    // Outcome and relevance remain model decisions. Display complete supplied
    // passages; no copied text is repaired, truncated or substituted.
    const displaySpans = spans.map((span) => ({ ...span }))
    const selectedSources = new Set(spans.map((span) => span.source))
    const requiredReferences = references.filter((reference) =>
      reference.kind === 'code'
        ? selectedSources.has(reference.source)
        : spans.some(
            (span) =>
              span.source === reference.source &&
              reference.start >= span.start &&
              reference.end <= span.end,
          ),
    )
    // In full mode, attach every available
    // question-call result from selected sources and every selected quantity's
    // conversion. This does not establish semantic relevance or applicability.
    const leads = {
      en: {
        compatible:
          'The supplied excerpts can be read consistently. The cited source statements are:',
        unresolved:
          'I cannot establish a single definitive answer from the supplied excerpts. The cited source statements are:',
        insufficient:
          'The supplied excerpts do not provide enough evidence to answer this question. This does not establish what the rest of the document contains. The cited excerpts are:',
      },
      de: {
        compatible:
          'Die bereitgestellten Textstellen lassen sich miteinander vereinbaren. Die angeführten Quellenaussagen sind:',
        unresolved:
          'Aus den bereitgestellten Textstellen kann ich keine eindeutige Antwort ableiten. Die angeführten Quellenaussagen sind:',
        insufficient:
          'Die bereitgestellten Textstellen reichen zur Beantwortung dieser Frage nicht aus. Daraus folgt keine Aussage über den übrigen Dokumentinhalt. Die angeführten Textstellen sind:',
      },
    }
    let markdown = leads[language][result.outcome]
    const expected: CitationMatch[] = []
    const cite = (source: string): void => {
      const [documentId, chunkId] = source.split(':').map(Number)
      markdown += ' '
      const start = markdown.length
      markdown += `[doc:${documentId}, chunk:${chunkId}]`
      expected.push({ documentId: documentId!, chunkId: chunkId!, start, end: markdown.length })
    }
    for (const span of displaySpans) {
      markdown += '\n\n' + sourceQuoteMarkdown(span.text) + '\n\n'
      cite(span.source)
    }
    if (requiredReferences.length) {
      markdown +=
        language === 'de'
          ? '\n\nRechnerisch aus den angeführten Quellen; keine Aussage zur Verbindlichkeit:'
          : '\n\nComputed from the cited sources; this does not establish which source governs:'
      for (const reference of requiredReferences) {
        markdown += '\n\n' + escapeSourceMarkdown(reference.expression)
        cite(reference.source)
      }
    }
    // Selected source display is program-produced, not generated prose. Keep
    // its independent bounded render allowance even when the model's output
    // budget (and the ordinary answer limit above) is smaller.
    if (markdown.length > LIMITS.renderedChars) return reject('render')
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
      return reject('citations')
    return {
      mode: 'comparison',
      outcome: result.outcome,
      answer: markdown,
      spans,
      displaySpans,
      derivations: requiredReferences.map((reference) => ({ ...reference })),
    }
  }
  return {
    version: COMPARISON_ANSWER_VERSION,
    comparisonMode,
    conciseUnitCount: 0,
    conciseFallbackReason: undefined,
    summaryMaxCodePoints,
    promptSourceText(documentId: number, chunkId: number): string {
      const passage = sources.get(`${documentId}:${chunkId}`)
      if (!passage) throw new Error('Unknown comparison passage')
      return passage.text
    },
    jsonSchema: schema,
    parse,
  }
}
