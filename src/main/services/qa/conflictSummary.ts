/** A reporting grammar for unresolved alternatives, not an entailment verifier.
 * The model selects exact evidence and documentary issues; only the program
 * supplies reporting verbs, connectors and evidence-scoped uncertainty. */
import { findCitationMatches, type CitationMatch } from '../../../shared/citationMarkers'
import { escapeSourceMarkdown } from '../../../shared/sourceQuoteMarkdown'
import { createSourceExcerptMatcher, createSourceFragmentMatcher } from './sourceFragments'
import type { ComparisonAnswerRejectionDetail, ComparisonSourceSpan } from './comparisonAnswer'

const ISSUES = [
  'approval',
  'priority',
  'correction',
  'authority',
  'scope',
  'effective_date',
] as const
type Issue = (typeof ISSUES)[number]
const LABELS: Record<'en' | 'de', Record<Issue, string>> = {
  en: {
    approval: 'approval',
    priority: 'priority',
    correction: 'correction',
    authority: 'authority',
    scope: 'shared scope',
    effective_date: 'effective date',
  },
  de: {
    approval: 'Freigabe',
    priority: 'Vorrang',
    correction: 'Korrektur',
    authority: 'Autorität',
    scope: 'gemeinsamen Geltungsbereich',
    effective_date: 'Wirksamkeitsdatum',
  },
}
export const CONFLICT_SUMMARY_LIMITS = {
  fragment: 160,
  label: 80,
  scope: 3,
  alternatives: 4,
  grounds: 3,
  evidence: 4,
  sources: 4,
  rendered: 512,
} as const
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, names: string[]): boolean =>
  Object.keys(value).join(',') === names.join(',')
const list = (value: unknown, min: number, max: number): value is unknown[] =>
  Array.isArray(value) && value.length >= min && value.length <= max

export function conflictSummarySchema(ids: string[]) {
  const evidence = {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: CONFLICT_SUMMARY_LIMITS.fragment },
      source: { enum: ids },
    },
    required: ['text', 'source'],
    additionalProperties: false,
  }
  return {
    type: 'object',
    properties: {
      scope: {
        type: 'array',
        minItems: 1,
        maxItems: CONFLICT_SUMMARY_LIMITS.scope,
        items: evidence,
      },
      alternatives: {
        type: 'array',
        minItems: 2,
        maxItems: CONFLICT_SUMMARY_LIMITS.alternatives,
        items: {
          type: 'object',
          properties: {
            label: {
              oneOf: [
                { type: 'string', minLength: 1, maxLength: CONFLICT_SUMMARY_LIMITS.label },
                {
                  type: 'object',
                  properties: { kind: { const: 'heading' } },
                  required: ['kind'],
                  additionalProperties: false,
                },
              ],
            },
            value: { type: 'string', minLength: 1, maxLength: CONFLICT_SUMMARY_LIMITS.fragment },
            source: { enum: ids },
          },
          required: ['label', 'value', 'source'],
          additionalProperties: false,
        },
      },
      grounds: {
        type: 'array',
        minItems: 1,
        maxItems: CONFLICT_SUMMARY_LIMITS.grounds,
        items: {
          type: 'object',
          properties: {
            kind: { enum: [...ISSUES] },
            evidence: {
              type: 'array',
              minItems: 1,
              maxItems: CONFLICT_SUMMARY_LIMITS.evidence,
              items: evidence,
            },
          },
          required: ['kind', 'evidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['scope', 'alternatives', 'grounds'],
    additionalProperties: false,
  }
}

/** Select only a complete leading ATX heading from this passage, never a
 * filename, heading metadata, translated name or inferred record label.
 * A second ATX-looking line conservatively makes the selector unavailable,
 * even inside a later code block; explicit entry fragments remain available. */
function leadingHeading(text: string): { text: string; start: number; end: number } | null {
  let selected: { text: string; start: number; end: number } | null = null
  for (const line of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const body = line[0].replace(/(?:\r\n|\r|\n)$/u, '')
    if (!body.trim()) continue
    const prefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/u.exec(body)
    if (selected) {
      if (prefix) return null
      continue
    }
    if (!prefix) return null
    const name = body
      .slice(prefix[0].length)
      .replace(/[ \t]+#+[ \t]*$/u, '')
      .replace(/[ \t]+$/u, '')
    if (!name) return null
    const start = line.index + prefix[0].length
    selected = { text: name, start, end: start + name.length }
  }
  return selected
}

/** Exact matches prove origin only. They cannot certify that selected labels,
 * values or scope belong together, that qualifiers were retained, that an issue
 * is entailed, or that all requested alternatives were selected. Keep those
 * independent semantic acceptance requirements, including requested language. */
export function renderConflictSummary(
  value: unknown,
  sources: ReadonlyMap<string, { text: string }>,
  language: 'en' | 'de',
  maxCharacters: number,
  onReject: (detail: ComparisonAnswerRejectionDetail) => void,
): { answer: string; spans: ComparisonSourceSpan[]; displaySpans: ComparisonSourceSpan[] } | null {
  const reject = (detail: ComparisonAnswerRejectionDetail): null => {
    onReject(detail)
    return null
  }
  if (
    !object(value) ||
    !keys(value, ['scope', 'alternatives', 'grounds']) ||
    !list(value.scope, 1, CONFLICT_SUMMARY_LIMITS.scope) ||
    !list(value.alternatives, 2, CONFLICT_SUMMARY_LIMITS.alternatives) ||
    !list(value.grounds, 1, CONFLICT_SUMMARY_LIMITS.grounds)
  )
    return reject('summary_shape')
  const matchers = new Map(
    [...sources].map(([id, source]) => [
      id,
      {
        fragment: createSourceFragmentMatcher(source.text),
        excerpt: createSourceExcerptMatcher(source.text),
      },
    ]),
  )
  const spans: ComparisonSourceSpan[] = []
  const selectedSources = new Set<string>()
  let failure: ComparisonAnswerRejectionDetail = 'evidence_shape'
  const match = (
    text: unknown,
    source: unknown,
    role: 'label' | 'value' | 'scope' | 'ground',
  ): ComparisonSourceSpan | null => {
    if (typeof source !== 'string' || !matchers.has(source)) {
      failure = 'evidence_source'
      return null
    }
    const matcher = matchers.get(source)!
    const detail = (reason: 'display' | 'missing' | 'boundary') => {
      failure = `${role === 'label' ? 'label' : 'excerpt'}_${reason}`
    }
    const found =
      role === 'ground'
        ? matcher.excerpt(text, CONFLICT_SUMMARY_LIMITS.fragment, detail)?.selected
        : matcher.fragment(
            text,
            role === 'label' ? CONFLICT_SUMMARY_LIMITS.label : CONFLICT_SUMMARY_LIMITS.fragment,
            detail,
          )
    if (!found) return null
    const span = { source, ...found }
    spans.push(span)
    selectedSources.add(source)
    return span
  }
  const scopes: ComparisonSourceSpan[] = []
  for (const scope of value.scope) {
    if (!object(scope) || !keys(scope, ['text', 'source'])) return reject('evidence_shape')
    const found = match(scope.text, scope.source, 'scope')
    if (!found) return reject(failure)
    scopes.push(found)
  }
  const alternatives: Array<{ label: ComparisonSourceSpan; value: ComparisonSourceSpan }> = []
  const alternativesSeen = new Set<string>()
  for (const alternative of value.alternatives) {
    if (!object(alternative) || !keys(alternative, ['label', 'value', 'source']))
      return reject('evidence_shape')
    let label: ComparisonSourceSpan | null
    if (typeof alternative.label === 'string') {
      label = match(alternative.label, alternative.source, 'label')
    } else {
      if (
        !object(alternative.label) ||
        !keys(alternative.label, ['kind']) ||
        alternative.label.kind !== 'heading'
      )
        return reject('evidence_shape')
      // A document heading cannot distinguish multiple alternatives within the
      // same passage; those need explicit entry labels from that body.
      if (
        value.alternatives.filter((item) => object(item) && item.source === alternative.source)
          .length !== 1
      )
        return reject('evidence_shape')
      const source =
        typeof alternative.source === 'string' ? sources.get(alternative.source) : undefined
      if (!source) return reject('evidence_source')
      const heading = leadingHeading(source.text)
      if (!heading) return reject('label_missing')
      label = match(heading.text, alternative.source, 'label')
      // The heading selector must identify the real body span, not another
      // matching occurrence or a source catalog title outside that passage.
      if (label && (label.start !== heading.start || label.end !== heading.end))
        return reject('label_missing')
    }
    if (!label) return reject(failure)
    const found = match(alternative.value, alternative.source, 'value')
    if (!found) return reject(failure)
    const identity = JSON.stringify([label.source, label.start, label.end, found.start, found.end])
    if (alternativesSeen.has(identity)) return reject('evidence_shape')
    alternativesSeen.add(identity)
    alternatives.push({ label, value: found })
  }
  const grounds: Array<{ kind: Issue; evidence: ComparisonSourceSpan[] }> = []
  const issuesSeen = new Set<string>()
  for (const ground of value.grounds) {
    if (
      !object(ground) ||
      !keys(ground, ['kind', 'evidence']) ||
      typeof ground.kind !== 'string' ||
      !ISSUES.includes(ground.kind as Issue) ||
      issuesSeen.has(ground.kind) ||
      !list(ground.evidence, 1, CONFLICT_SUMMARY_LIMITS.evidence)
    )
      return reject('evidence_shape')
    issuesSeen.add(ground.kind)
    const evidence: ComparisonSourceSpan[] = []
    for (const item of ground.evidence) {
      if (!object(item) || !keys(item, ['text', 'source'])) return reject('evidence_shape')
      const found = match(item.text, item.source, 'ground')
      if (!found) return reject(failure)
      evidence.push(found)
    }
    grounds.push({ kind: ground.kind as Issue, evidence })
  }
  if (selectedSources.size > CONFLICT_SUMMARY_LIMITS.sources) return reject('evidence_source')
  // A copied scope that is the very same cited label need not be displayed
  // twice. Keep its validated evidence span; never fold merely similar words,
  // a partial label, another source's wording, or distinct scope/qualifiers.
  const visibleScopes = scopes.filter(
    (scope) =>
      !alternatives.some(
        ({ label }) =>
          scope.source === label.source &&
          scope.start === label.start &&
          scope.end === label.end &&
          scope.text === label.text,
      ),
  )
  const displaySpans = [
    ...visibleScopes,
    ...alternatives.flatMap(({ label, value }) => [label, value]),
  ].map((span) => ({ ...span }))
  let answer = visibleScopes.length ? (language === 'de' ? 'Zu ' : 'For ') : ''
  const expected: CitationMatch[] = []
  const quote = (text: string): string =>
    (language === 'de' ? '„' : '“') + escapeSourceMarkdown(text) + (language === 'de' ? '“' : '”')
  const cite = (ids: string[]): void => {
    for (const id of new Set(ids)) {
      const [documentId, chunkId] = id.split(':').map(Number)
      answer += ' '
      const start = answer.length
      answer += `[doc:${documentId}, chunk:${chunkId}]`
      expected.push({ documentId: documentId!, chunkId: chunkId!, start, end: answer.length })
    }
  }
  const join = (parts: string[]): string =>
    parts.length === 1
      ? parts[0]!
      : parts.slice(0, -1).join(', ') + (language === 'de' ? ' und ' : ' and ') + parts.at(-1)!
  if (visibleScopes.length) {
    answer += join(visibleScopes.map((scope) => quote(scope.text)))
    cite(visibleScopes.map((scope) => scope.source))
    answer += language === 'de' ? ' nennt ' : ', '
  }
  for (const [index, alternative] of alternatives.entries()) {
    if (index)
      answer += index === alternatives.length - 1 ? (language === 'de' ? ' und ' : ' and ') : ', '
    answer +=
      quote(alternative.label.text) +
      (language === 'de' ? (index === 0 && visibleScopes.length ? ' ' : ' nennt ') : ' reports ') +
      quote(alternative.value.text)
    cite([alternative.value.source])
  }
  answer +=
    language === 'de' ? '; weil diese Textstellen ' : '; because these excerpts do not establish '
  answer += join(grounds.map((ground) => LABELS[language][ground.kind]))
  answer +=
    language === 'de'
      ? ' nicht belegen, bleibt offen, welche Angabe gilt'
      : ', which statement governs remains unresolved'
  cite(grounds.flatMap((ground) => ground.evidence.map((item) => item.source)))
  answer += '.'
  if (Array.from(answer).length > Math.min(CONFLICT_SUMMARY_LIMITS.rendered, maxCharacters))
    return reject('render_bound')
  const actual = findCitationMatches(answer)
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
    return reject('render_mismatch')
  return { answer, spans, displaySpans }
}
