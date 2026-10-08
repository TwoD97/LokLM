import type { RetrievalHit } from '../../../src/shared/documents'
import { reasoningSystem20261005 } from './reasoningDiagnostic20261005'
import { buildPrompt, type ResponseLanguage } from '../../../src/main/services/llm/prompt'

const sourceKey = (hit: RetrievalHit) => `${hit.document_id}:${hit.chunk_id}`

/** Experimental single-pass answer, not a semantic validator or a second model call. */
export function structuredAnswerPlan20261005(
  question: string,
  hits: RetrievalHit[],
  language: ResponseLanguage,
) {
  const ids = hits.map(sourceKey)
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Distinct supplied source IDs required')
  return {
    maxTokens: 512,
    systemPrompt: `${reasoningSystem20261005(language)}
Return a JSON answer instead of prose. First select only answer-bearing evidence: each source ID and a short exact contiguous quotation from that source. Do not select irrelevant passages just because they were supplied. Next write one short comparison or calculation to check the proposed conclusion; this is an explanation, not a confidence score. Then choose answered, unresolved or missing and write the final answer as at most four short claims in the requested language and format. Each claim names its supporting source IDs. The program attaches those citations; do not type citation markers inside claim text. An unresolved answer must state the competing supported facts without inventing a governing source. A missing answer must not fabricate facts. Do not repeat the evidence quotations in the final claims unless the user requests quotation. Output JSON only.`,
    prompt: `${buildPrompt(question, hits, undefined, language)}\n\nJSON shape: {"evidence":[{"source":"DOC:CHUNK","quote":"exact source text"}],"comparison":"short check","status":"answered|unresolved|missing","claims":[{"text":"final answer claim","sources":["DOC:CHUNK"]}]}. Use the numeric IDs from the actual source headers.`,
    jsonSchema: {
      type: 'object',
      properties: {
        evidence: {
          type: 'array',
          minItems: 0,
          maxItems: 4,
          items: {
            type: 'object',
            properties: { source: { enum: ids }, quote: { type: 'string' } },
            required: ['source', 'quote'],
            additionalProperties: false,
          },
        },
        comparison: { type: 'string' },
        status: { enum: ['answered', 'unresolved', 'missing'] },
        claims: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              sources: { type: 'array', minItems: 0, maxItems: 4, items: { enum: ids } },
            },
            required: ['text', 'sources'],
            additionalProperties: false,
          },
        },
      },
      required: ['evidence', 'comparison', 'status', 'claims'],
      additionalProperties: false,
    },
  }
}

export interface StructuredAnswer20261005 {
  evidence: Array<{ source: string; quote: string }>
  comparison: string
  status: 'answered' | 'unresolved' | 'missing'
  claims: Array<{ text: string; sources: string[] }>
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const hasKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

/** Structural/quotation membership only. It does not prove scope, arithmetic or authority. */
export function parseStructuredAnswer20261005(
  raw: string,
  hits: RetrievalHit[],
): StructuredAnswer20261005 | null {
  if (raw.length > 12000) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!object(value) || !hasKeys(value, ['evidence', 'comparison', 'status', 'claims'])) return null
  if (
    !['answered', 'unresolved', 'missing'].includes(String(value.status)) ||
    typeof value.comparison !== 'string' ||
    value.comparison.length > 600
  )
    return null
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length > 4 ||
    !Array.isArray(value.claims) ||
    !value.claims.length ||
    value.claims.length > 4
  )
    return null
  const selected = new Set<string>()
  for (const evidence of value.evidence) {
    if (
      !object(evidence) ||
      !hasKeys(evidence, ['source', 'quote']) ||
      typeof evidence.source !== 'string' ||
      typeof evidence.quote !== 'string' ||
      !evidence.quote.trim() ||
      evidence.quote.length > 300
    )
      return null
    const hit = hits.find((candidate) => sourceKey(candidate) === evidence.source)
    if (!hit || !hit.text.includes(evidence.quote)) return null
    selected.add(evidence.source)
  }
  for (const claim of value.claims) {
    if (
      !object(claim) ||
      !hasKeys(claim, ['text', 'sources']) ||
      typeof claim.text !== 'string' ||
      !claim.text.trim() ||
      claim.text.length > 1000 ||
      /\[doc\s*:|#cite-/i.test(claim.text)
    )
      return null
    if (
      !Array.isArray(claim.sources) ||
      claim.sources.length > 4 ||
      new Set(claim.sources).size !== claim.sources.length ||
      claim.sources.some((id) => typeof id !== 'string' || !selected.has(id))
    )
      return null
    if (value.status !== 'missing' && !claim.sources.length) return null
  }
  return value as unknown as StructuredAnswer20261005
}

export function renderStructuredAnswer20261005(answer: StructuredAnswer20261005): string {
  return answer.claims
    .map((claim) => {
      const citations = claim.sources
        .map((id) => {
          const [doc, chunk] = id.split(':')
          return `[doc:${doc}, chunk:${chunk}]`
        })
        .join(' ')
      return `${claim.text}${citations ? ` ${citations}` : ''}`
    })
    .join(' ')
}
