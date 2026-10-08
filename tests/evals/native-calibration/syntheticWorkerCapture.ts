/** Test-only synthetic diagnostics. This module is never imported by the application. */
type SyntheticShape = {
  type: string
  knownKeys?: string[]
  unknownKeyCount?: number
  types?: Record<string, string>
}
type SyntheticBlocksShape = {
  type: string
  length?: number
  inspected?: number
  records?: Array<SyntheticShape & { index: number }>
}
type SyntheticEvidenceEntry = {
  location: string
  type: string
  codepoints?: number
  quote?: string
  omitted?: boolean
  object?: SyntheticShape
  label?: { type: string; codepoints?: number }
  fragmentCount?: { type: string; value?: number }
  excerpts?: {
    type: string
    length?: number
    inspected?: number
    entries?: Array<{ type: string; codepoints?: number }>
  }
}
type SyntheticLabelShapes = {
  counts: Record<
    | 'exact_colon_pair'
    | 'spaced_colon_pair'
    | 'comma_chunk_pair'
    | 'grouped_complete_pairs'
    | 'no_closing_parenthesis'
    | 'line_break'
    | 'invalid_id'
    | 'other_syntax',
    number
  >
  candidates: number
  inspectedBlocks: number
  inspectedChars: number
  capped: boolean
}
type SyntheticEvidenceCapture = { evidence: SyntheticEvidenceEntry[] } & (
  | {
      envelopeParsed: false
      inputBoundExceeded: boolean
      externalLineBreaks?: never
      structure?: never
      omittedEvidence?: never
      sourceLabelShapes?: never
    }
  | {
      envelopeParsed: true
      inputBoundExceeded: false
      externalLineBreaks: number
      structure: {
        root: SyntheticShape
        check: { type: string; codepoints?: number }
        recordCount?: { type: string; value?: number }
        result: SyntheticShape
        summary?: SyntheticShape
        blocks: SyntheticBlocksShape
        rootBlocks: SyntheticBlocksShape
      }
      omittedEvidence: number
      sourceLabelShapes?: SyntheticLabelShapes
    }
)

export function sanitizeSyntheticEvidence(
  raw: unknown,
  options?: {
    sourceLabelShapes?: boolean
    legacyExcerptLabels?: boolean
    budgetedExcerptCounts?: boolean
  },
): SyntheticEvidenceCapture {
  function kind(value: unknown): string {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  }
  function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  function shape(value: unknown, known: string[]) {
    return {
      type: kind(value),
      ...(object(value)
        ? {
            knownKeys: known.filter((key) => Object.hasOwn(value, key)),
            unknownKeyCount: Object.keys(value).filter((key) => !known.includes(key)).length,
            types: Object.fromEntries(
              known
                .filter((key) => Object.hasOwn(value, key))
                .map((key) => [key, kind(value[key])]),
            ),
          }
        : {}),
    }
  }
  const resultKeys = [
    'resolution',
    'blocks',
    'summary',
    'outcome',
    'sources',
    'units',
    'evidence',
    'answer',
    'text',
  ]
  if (options?.budgetedExcerptCounts === true) resultKeys.splice(1, 0, 'recordCount')
  const countShape = (value: unknown, maximum: number) => ({
    type: kind(value),
    ...(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= maximum
      ? { value }
      : {}),
  })
  const evidence: SyntheticEvidenceEntry[] = []
  if (typeof raw !== 'string' || raw.length > 256_000)
    return { envelopeParsed: false, inputBoundExceeded: true, evidence }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { envelopeParsed: false, inputBoundExceeded: false, evidence }
  }
  const result = object(value) ? value.result : undefined
  const check = object(value) ? value.check : undefined
  // Observed syntax only: protected/literal occurrences are deliberately included.
  // These counts cannot identify which unmasked label (if any) caused rejection.
  function sourceLabelShapes() {
    const counts = {
      exact_colon_pair: 0,
      spaced_colon_pair: 0,
      comma_chunk_pair: 0,
      grouped_complete_pairs: 0,
      no_closing_parenthesis: 0,
      line_break: 0,
      invalid_id: 0,
      other_syntax: 0,
    }
    let inspectedBlocks = 0
    let inspectedChars = 0
    let candidates = 0
    let capped = false
    const blocks = object(result) ? result.blocks : undefined
    const hasSummary = object(result) && Object.hasOwn(result, 'summary')
    // Only fixed visible-answer fields; never inspect check, root text or
    // arbitrary nested objects. Both shapes share the existing scan budget.
    const recordCount = (Array.isArray(blocks) ? blocks.length : 0) + (hasSummary ? 1 : 0)
    const records: unknown[] = Array.isArray(blocks) ? blocks.slice(0, 128) : []
    if (hasSummary && records.length < 128) records.push(result.summary)
    if (records.length) {
      capped = recordCount > 128
      for (const block of records) {
        inspectedBlocks++
        if (!object(block) || typeof block.text !== 'string') continue
        const remaining = 32_000 - inspectedChars
        if (remaining === 0) {
          capped = true
          break
        }
        const text = block.text.slice(0, remaining)
        const wholeText = text.length === block.text.length
        if (!wholeText) capped = true
        inspectedChars += text.length
        const opening = /\(\s*doc\b/giu
        for (const match of text.matchAll(opening)) {
          if (candidates === 128) {
            capped = true
            break
          }
          candidates++
          const start = match.index
          const closing = text.indexOf(')', start + match[0].length)
          if (closing === -1 && !wholeText) {
            capped = true
            continue // A scan boundary is not evidence of a missing parenthesis.
          }
          const end = closing === -1 ? text.length : closing + 1
          if (end - start > 512) {
            capped = true
            continue
          }
          const label = text.slice(start, end)
          if (/[\r\n]/u.test(label)) counts.line_break++
          if (closing === -1) {
            counts.no_closing_parenthesis++
            continue
          }
          const colon = /^doc[ \t]*:[ \t]*([^\s():,;]+)[ \t]*:[ \t]*([^\s():,;]+)$/iu
          const comma =
            /^doc[ \t]*:[ \t]*([^\s():,;]+)[ \t]*,[ \t]*chunk[ \t]*:[ \t]*([^\s():,;]+)$/iu
          const inner = label.slice(1, -1).replace(/^[ \t]+|[ \t]+$/gu, '')
          const parts = inner.split(/[ \t]*;[ \t]*|[ \t]*,[ \t]*(?=doc\b)/giu)
          const pairs = parts.map((part) => colon.exec(part) ?? comma.exec(part))
          if (parts.length > 1 && pairs.every((pair) => pair !== null))
            counts.grouped_complete_pairs++
          else if (/^\(doc:[^\s():,;]+:[^\s():,;]+\)$/iu.test(label)) counts.exact_colon_pair++
          else if (parts.length === 1 && colon.test(inner)) counts.spaced_colon_pair++
          else if (parts.length === 1 && comma.test(inner)) counts.comma_chunk_pair++
          else counts.other_syntax++
          if (
            pairs.some(
              (pair) =>
                pair !== null &&
                pair
                  .slice(1)
                  .some((id) => !/^[1-9]\d{0,15}$/u.test(id) || !Number.isSafeInteger(Number(id))),
            )
          )
            counts.invalid_id++
        }
        if (candidates === 128) {
          if (recordCount > inspectedBlocks) capped = true
          break
        }
      }
    }
    return { counts, candidates, inspectedBlocks, inspectedChars, capped }
  }
  let retainedCodepoints = 0
  let omittedEvidence = 0
  function quote(location: string, candidate: unknown): void {
    if (evidence.length >= 128) {
      omittedEvidence++
      return
    }
    if (typeof candidate !== 'string') {
      evidence.push({ location, type: kind(candidate) })
      return
    }
    const codepoints = Array.from(candidate).length
    if (options?.sourceLabelShapes === true) {
      // Current source-ID captures need no historical free-quote evidence.
      // A malformed response must not smuggle body/label text into this channel.
      evidence.push({ location, type: 'string', codepoints, omitted: true })
      return
    }
    if (codepoints > 2000 || retainedCodepoints + codepoints > 32_000) {
      evidence.push({ location, type: 'string', codepoints, omitted: true })
      return
    }
    retainedCodepoints += codepoints
    evidence.push({ location, type: 'string', codepoints, quote: candidate })
  }
  function inspectEvidence(location: string, entry: unknown): void {
    const items = Array.isArray(entry) ? entry.slice(0, 128) : [entry]
    if (Array.isArray(entry) && entry.length > 128) omittedEvidence += entry.length - 128
    items.forEach((item, index) => {
      const at = Array.isArray(entry) ? `${location}[${index}]` : location
      if (object(item)) {
        if (evidence.length >= 128) {
          omittedEvidence++
          return
        }
        if (Object.hasOwn(item, 'label') || Object.hasOwn(item, 'excerpts')) {
          // Literal-excerpt contracts expose shape/count metadata only, even if
          // malformed content includes historical quote/text keys. Never retain
          // a source identifier, caption, excerpt, nested object or arbitrary key.
          const lengths = (value: unknown) => ({
            type: kind(value),
            ...(typeof value === 'string' ? { codepoints: Array.from(value).length } : {}),
          })
          const excerpts = item.excerpts
          evidence.push({
            location: at,
            type: 'object',
            object: shape(
              item,
              options?.legacyExcerptLabels === true
                ? ['source', 'label', 'excerpts']
                : options?.budgetedExcerptCounts === true
                  ? ['source', 'fragmentCount', 'excerpts']
                  : ['source', 'excerpts'],
            ),
            ...(options?.budgetedExcerptCounts === true && Object.hasOwn(item, 'fragmentCount')
              ? { fragmentCount: countShape(item.fragmentCount, 3) }
              : {}),
            ...(options?.legacyExcerptLabels === true && Object.hasOwn(item, 'label')
              ? { label: lengths(item.label) }
              : {}),
            ...(Object.hasOwn(item, 'excerpts')
              ? {
                  excerpts: {
                    type: kind(excerpts),
                    ...(Array.isArray(excerpts)
                      ? {
                          length: excerpts.length,
                          inspected: Math.min(3, excerpts.length),
                          entries: excerpts.slice(0, 3).map(lengths),
                        }
                      : {}),
                  },
                }
              : {}),
          })
          return
        }
        evidence.push({ location: at, type: 'object', object: shape(item, ['quote', 'text']) })
        for (const key of ['quote', 'text'])
          if (Object.hasOwn(item, key)) quote(`${at}.${key}`, item[key])
      } else quote(at, item)
    })
  }
  function inspectContainer(container: unknown, prefix: string) {
    if (object(container) && Object.hasOwn(container, 'evidence'))
      inspectEvidence(`${prefix}.evidence`, container.evidence)
    const blocks = object(container) ? container.blocks : undefined
    if (!Array.isArray(blocks)) return { type: kind(blocks) }
    const records = blocks.slice(0, 128).map((block, index) => {
      if (object(block) && Object.hasOwn(block, 'evidence'))
        inspectEvidence(`${prefix}.blocks[${index}].evidence`, block.evidence)
      return { index, ...shape(block, ['text', 'evidence', 'sources']) }
    })
    return { type: 'array', length: blocks.length, inspected: records.length, records }
  }
  const blocks = inspectContainer(result, 'result')
  const rootBlocks = inspectContainer(value, 'root')
  return {
    envelopeParsed: true,
    inputBoundExceeded: false,
    // JSON.parse succeeded: literal CR/LF cannot occur inside JSON strings.
    // Escaped source newlines therefore do not affect this content-free count.
    externalLineBreaks: (raw.match(/\r\n|\r|\n/gu) ?? []).length,
    structure: {
      root: shape(value, ['check', 'result', ...resultKeys]),
      check: {
        type: kind(check),
        ...(typeof check === 'string' ? { codepoints: Array.from(check).length } : {}),
      },
      result: shape(result, resultKeys),
      ...(options?.budgetedExcerptCounts === true &&
      object(result) &&
      Object.hasOwn(result, 'recordCount')
        ? { recordCount: countShape(result.recordCount, 4) }
        : {}),
      ...(object(result) && Object.hasOwn(result, 'summary')
        ? {
            summary: shape(result.summary, ['text', 'sources', 'scope', 'alternatives', 'grounds']),
          }
        : {}),
      blocks,
      rootBlocks,
    },
    evidence,
    omittedEvidence,
    ...(options?.sourceLabelShapes === true ? { sourceLabelShapes: sourceLabelShapes() } : {}),
  }
}

export interface ObservableUtilityChild {
  postMessage: (...args: unknown[]) => unknown
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown
}
export interface ObservableUtilityProcess {
  fork: (...args: unknown[]) => ObservableUtilityChild
}

/** Self-contained so a test can serialize it into Electron's main process. */
export function installSyntheticWorkerObserver(
  utilityProcess: ObservableUtilityProcess,
  sanitize: (
    raw: unknown,
    options?: {
      sourceLabelShapes?: boolean
      legacyExcerptLabels?: boolean
      budgetedExcerptCounts?: boolean
    },
  ) => unknown,
  options: {
    workerPath: string
    expectedSchemaJson: string
    alternateExpectedSchemaJson?: string
    normalizeSourceEnum?: boolean
    captureSourceLabelShapes?: boolean
    /** Explicit replay-only bootstrap for the retired v24 generation policy. */
    historicalExcerptPolicy?: 'typed-comparison-v24'
    /** Explicit replay-only admission for previous source-budgeted families. */
    historicalExcerptBudgets?: 'typed-comparison-v27' | 'typed-comparison-v28'
  },
) {
  function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  function unwrap(value: unknown) {
    return object(value) && object(value.data) ? value.data : value
  }
  // Every family requires an exact configured template. Full/summary/excerpts
  // enums repeat the ordinary source catalog. Historical unit enums
  // repeat the complete sequential catalog. Normalize only these exact lists.
  // Never mutate the outgoing payload or retain its source IDs/prompt.
  function schemaIdentity(value: unknown): string | null {
    const encoded = JSON.stringify(value)
    if (typeof encoded !== 'string' || encoded.length > 256_000) return null
    if (!options.normalizeSourceEnum) return encoded
    const schema: unknown = JSON.parse(encoded)
    const properties = object(schema) ? schema.properties : undefined
    const result = object(properties) ? properties.result : undefined
    const variants = object(result) ? result.oneOf : undefined
    const answered = Array.isArray(variants) ? variants[0] : undefined
    const fields = object(answered) ? answered.properties : undefined
    const resolution = object(fields) ? fields.resolution : undefined
    const blocks = object(fields) ? fields.blocks : undefined
    const blockItems = object(blocks) ? blocks.items : undefined
    const blockFields = object(blockItems) ? blockItems.properties : undefined
    const sources = object(blockFields) ? blockFields.sources : undefined
    const items = object(sources) ? sources.items : undefined
    const ids = object(items) ? items.enum : undefined
    if (
      !object(resolution) ||
      resolution.const !== 'answered' ||
      !object(items) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 32 ||
      new Set(ids).size !== ids.length
    )
      return null
    for (const id of ids) {
      if (typeof id !== 'string' || !/^[1-9]\d{0,15}:[1-9]\d{0,15}$/u.test(id)) return null
      if (!id.split(':').every((part) => Number.isSafeInteger(Number(part)))) return null
    }
    if (!Array.isArray(variants) || !variants.length || variants.length > 5) return null
    const shortFields = object(variants[1]) ? variants[1].properties : undefined
    if (variants.length === 2 && object(shortFields) && Object.hasOwn(shortFields, 'summary')) {
      if (options.historicalExcerptBudgets !== undefined) return null
      const summary = object(shortFields.summary) ? shortFields.summary.properties : undefined
      if (object(summary) && Object.hasOwn(summary, 'scope')) {
        // v31/v32 repeat the same catalog in all three typed roles. Validate the
        // entire fixed branch before normalizing; no arbitrary subtree or
        // generation-policy drift is admitted. This function is serialized.
        const evidence = {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 160 },
            source: { enum: ids },
          },
          required: ['text', 'source'],
          additionalProperties: false,
        }
        const alternatives = object(summary.alternatives) ? summary.alternatives.items : undefined
        const alternativeFields = object(alternatives) ? alternatives.properties : undefined
        const label = object(alternativeFields) ? alternativeFields.label : undefined
        const headingSelector = object(label) && Array.isArray(label.oneOf)
        const fragmentLabel = { type: 'string', minLength: 1, maxLength: 80 }
        const expected = {
          type: 'object',
          properties: {
            resolution: { const: 'comparison' },
            summary: {
              type: 'object',
              properties: {
                scope: { type: 'array', minItems: 1, maxItems: 3, items: evidence },
                alternatives: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 4,
                  items: {
                    type: 'object',
                    properties: {
                      label: headingSelector
                        ? {
                            oneOf: [
                              fragmentLabel,
                              {
                                type: 'object',
                                properties: { kind: { const: 'heading' } },
                                required: ['kind'],
                                additionalProperties: false,
                              },
                            ],
                          }
                        : fragmentLabel,
                      value: { type: 'string', minLength: 1, maxLength: 160 },
                      source: { enum: ids },
                    },
                    required: ['label', 'value', 'source'],
                    additionalProperties: false,
                  },
                },
                grounds: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 3,
                  items: {
                    type: 'object',
                    properties: {
                      kind: {
                        enum: [
                          'approval',
                          'priority',
                          'correction',
                          'authority',
                          'scope',
                          'effective_date',
                        ],
                      },
                      evidence: { type: 'array', minItems: 1, maxItems: 4, items: evidence },
                    },
                    required: ['kind', 'evidence'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['scope', 'alternatives', 'grounds'],
              additionalProperties: false,
            },
            outcome: { const: 'unresolved' },
          },
          required: ['resolution', 'summary', 'outcome'],
          additionalProperties: false,
        }
        if (JSON.stringify(variants[1]) !== JSON.stringify(expected)) return null
        items.enum = ['<validated-supplied-source-ids>']
        variants.splice(1, 1, {
          typedSummary: headingSelector
            ? '<validated-v32-heading-reporting-roles>'
            : '<validated-v31-reporting-roles>',
        })
        return JSON.stringify(schema)
      }
      // Historical v29 has one unresolved short branch and an exact catalog-derived
      // final-display budget. The unchanged longest localized framing lead is73.
      const markerLengths = ids
        .map((id) => {
          const [document, chunk] = (id as string).split(':')
          return `[doc:${document}, chunk:${chunk}]`.length
        })
        .sort((a, b) => b - a)
      const count = Math.min(4, ids.length)
      const maximum =
        512 - 73 - 2 - 1 - (markerLengths.slice(0, count).reduce((sum, n) => sum + n, 0) + count)
      const expected = {
        type: 'object',
        properties: {
          resolution: { const: 'comparison' },
          summary: {
            type: 'object',
            properties: {
              text: { type: 'string', minLength: 1, maxLength: maximum },
              sources: { type: 'array', minItems: 1, maxItems: 4, items: { enum: ids } },
            },
            required: ['text', 'sources'],
            additionalProperties: false,
          },
          outcome: { const: 'unresolved' },
        },
        required: ['resolution', 'summary', 'outcome'],
        additionalProperties: false,
      }
      if (JSON.stringify(variants[1]) !== JSON.stringify(expected)) return null
      items.enum = ['<validated-supplied-source-ids>']
      variants.splice(1, 1, { summaryBudget: '<validated-v29-catalog-display-budget>' })
      return JSON.stringify(schema)
    }
    const budgeted =
      variants.length === 1 ||
      variants
        .slice(1)
        .some(
          (variant) =>
            object(variant) &&
            object(variant.properties) &&
            Object.hasOwn(variant.properties, 'recordCount'),
        )
    if (budgeted) {
      if (options.historicalExcerptBudgets === undefined) return null
      // Both historical count families require an explicit replay bootstrap.
      const minimumRecords = options.historicalExcerptBudgets === 'typed-comparison-v27' ? 1 : 2
      // Normalize only feasible N/source/M allocations and text-derived L.
      // Validate every exact public schema skeleton before erasing those values.
      // This proves structural admission, not source-text budget correctness.
      let previousCount = minimumRecords - 1
      for (const variant of variants.slice(1)) {
        const fields = object(variant) ? variant.properties : undefined
        const count =
          object(fields) && object(fields.recordCount) ? fields.recordCount.const : undefined
        const evidence = object(fields) ? fields.evidence : undefined
        const selections =
          object(evidence) && object(evidence.items) ? evidence.items.oneOf : undefined
        if (
          typeof count !== 'number' ||
          !Number.isInteger(count) ||
          (previousCount === minimumRecords - 1 && count !== minimumRecords) ||
          count <= previousCount ||
          count > 4 ||
          !Array.isArray(selections) ||
          !selections.length ||
          selections.length > ids.length * 3
        )
          return null
        previousCount = count
        let previousSelection = -1
        const expectedSelections = []
        for (const selection of selections) {
          const selectedFields = object(selection) ? selection.properties : undefined
          const source =
            object(selectedFields) && object(selectedFields.source)
              ? selectedFields.source.const
              : undefined
          const fragments =
            object(selectedFields) && object(selectedFields.fragmentCount)
              ? selectedFields.fragmentCount.const
              : undefined
          const excerpts = object(selectedFields) ? selectedFields.excerpts : undefined
          const length =
            object(excerpts) && object(excerpts.items) ? excerpts.items.maxLength : undefined
          const sourceIndex = ids.indexOf(source)
          if (
            sourceIndex < 0 ||
            typeof fragments !== 'number' ||
            !Number.isInteger(fragments) ||
            fragments < 1 ||
            fragments > 3 ||
            typeof length !== 'number' ||
            !Number.isInteger(length) ||
            length < 1 ||
            length > 160
          )
            return null
          const position = sourceIndex * 3 + fragments
          if (position <= previousSelection) return null
          previousSelection = position
          const expected = {
            type: 'object',
            properties: {
              source: { const: source },
              fragmentCount: { const: fragments },
              excerpts: {
                type: 'array',
                minItems: fragments,
                maxItems: fragments,
                items: { type: 'string', minLength: 1, maxLength: length },
              },
            },
            required: ['source', 'fragmentCount', 'excerpts'],
            additionalProperties: false,
          }
          if (JSON.stringify(selection) !== JSON.stringify(expected)) return null
          expectedSelections.push(expected)
        }
        const expected = {
          type: 'object',
          properties: {
            resolution: { const: 'comparison' },
            recordCount: { const: count },
            evidence: {
              type: 'array',
              minItems: count,
              maxItems: count,
              items: { oneOf: expectedSelections },
            },
            outcome: { const: 'unresolved' },
          },
          required: ['resolution', 'recordCount', 'evidence', 'outcome'],
          additionalProperties: false,
        }
        if (JSON.stringify(variant) !== JSON.stringify(expected)) return null
      }
      items.enum = ['<validated-supplied-source-ids>']
      variants.splice(1, variants.length - 1, {
        budgetedExcerpts:
          minimumRecords === 1
            ? '<validated-historical-v27-allocations>'
            : '<validated-v28-alternative-allocations>',
      })
      return JSON.stringify(schema)
    }
    if (encoded.length > 64_000 || (variants.length !== 3 && variants.length !== 2)) return null
    const catalog = JSON.stringify(ids)
    const comparisonItems: Record<string, unknown>[] = []
    let comparisonKind: 'sources' | 'units' | 'summary' | 'evidence' | undefined
    let unitCatalog: string | undefined
    for (let index = 1; index < variants.length; index++) {
      const variant = variants[index]
      const fields = object(variant) ? variant.properties : undefined
      const resolution = object(fields) ? fields.resolution : undefined
      if (!object(fields) || !object(resolution) || resolution.const !== 'comparison') return null
      const hasSources = Object.hasOwn(fields, 'sources')
      const hasUnits = Object.hasOwn(fields, 'units')
      const hasSummary = Object.hasOwn(fields, 'summary')
      const hasEvidence = Object.hasOwn(fields, 'evidence')
      if (Number(hasSources) + Number(hasUnits) + Number(hasSummary) + Number(hasEvidence) !== 1)
        return null
      const kind = hasSources ? 'sources' : hasUnits ? 'units' : hasSummary ? 'summary' : 'evidence'
      if ((variants.length === 2) !== (kind === 'evidence')) return null
      if (comparisonKind !== undefined && comparisonKind !== kind) return null
      comparisonKind = kind
      const selection = fields[kind]
      const summaryFields =
        kind === 'summary' && object(selection) ? selection.properties : undefined
      const summarySources = object(summaryFields) ? summaryFields.sources : undefined
      const evidenceItems = kind === 'evidence' && object(selection) ? selection.items : undefined
      const evidenceFields = object(evidenceItems) ? evidenceItems.properties : undefined
      const candidateItems =
        kind === 'evidence'
          ? object(evidenceFields)
            ? evidenceFields.source
            : undefined
          : kind === 'summary'
            ? object(summarySources)
              ? summarySources.items
              : undefined
            : object(selection)
              ? selection.items
              : undefined
      if (!object(candidateItems)) return null
      if (kind !== 'units') {
        if (JSON.stringify(candidateItems.enum) !== catalog) return null
      } else {
        const units = candidateItems.enum
        if (!Array.isArray(units) || units.length < ids.length || units.length > 256) return null
        // Labels must cover the complete deterministic catalog, with no gaps,
        // duplication, leading zeroes or arbitrary model/source text.
        if (!units.every((id, offset) => id === `U${offset + 1}`)) return null
        const encodedUnits = JSON.stringify(units)
        if (unitCatalog !== undefined && unitCatalog !== encodedUnits) return null
        unitCatalog = encodedUnits
      }
      comparisonItems.push(candidateItems)
    }
    items.enum = ['<validated-supplied-source-ids>']
    for (const candidateItems of comparisonItems)
      candidateItems.enum = [
        comparisonKind === 'units'
          ? '<validated-original-unit-ids>'
          : '<validated-supplied-source-ids>',
      ]
    return JSON.stringify(schema)
  }
  const expectedSchemaIdentities = [schemaIdentity(JSON.parse(options.expectedSchemaJson))]
  if (options.alternateExpectedSchemaJson !== undefined)
    expectedSchemaIdentities.push(schemaIdentity(JSON.parse(options.alternateExpectedSchemaJson)))
  if (expectedSchemaIdentities.some((identity) => identity === null))
    throw new Error('Invalid synthetic observer schema')
  const originalFork = utilityProcess.fork
  const rows: Array<Record<string, unknown>> = []
  const cleanups = new Set<() => void>()
  let armed: string | null = null
  let disposed = false
  let workers = 0
  let observerErrors = 0
  let dropped = 0
  let pendingCount = 0
  function retain(row: Record<string, unknown>): void {
    if (rows.length < 32) rows.push(row)
    else dropped++
  }
  function fork(this: unknown, ...args: unknown[]) {
    const child = Reflect.apply(originalFork, this, args) as ObservableUtilityChild
    const forkOptions = args[2]
    if (
      disposed ||
      args[0] !== options.workerPath ||
      !object(forkOptions) ||
      forkOptions.serviceName !== 'loklm-models'
    )
      return child
    const worker = ++workers
    const pending = new Map<
      number,
      {
        caseId: string
        startedAt: number
        sourceLabelShapes: boolean
        legacyExcerptLabels: boolean
        budgetedExcerptCounts: boolean
        requestedJsonStringPolicy?: 'source-excerpts'
      }
    >()
    const originalPost = child.postMessage
    function postMessage(this: unknown, ...postArgs: unknown[]) {
      let watched: number | undefined
      try {
        const message = unwrap(postArgs[0])
        const payload = object(message) ? message.payload : undefined
        const hasStringPolicy = object(payload) && Object.hasOwn(payload, 'jsonStringPolicy')
        const schema = object(payload) ? payload.jsonSchema : undefined
        const properties = object(schema) ? schema.properties : undefined
        const result = object(properties) ? properties.result : undefined
        const variants = object(result) ? result.oneOf : undefined
        const comparison = Array.isArray(variants) ? variants[1] : undefined
        const comparisonFields = object(comparison) ? comparison.properties : undefined
        const evidence = object(comparisonFields) ? comparisonFields.evidence : undefined
        const evidenceItems = object(evidence) ? evidence.items : undefined
        const evidenceFields = object(evidenceItems) ? evidenceItems.properties : undefined
        const legacyExcerptLabels = object(evidenceFields) && Object.hasOwn(evidenceFields, 'label')
        const budgetedExcerptCounts =
          Array.isArray(variants) &&
          (variants.length === 1 ||
            (object(comparisonFields) && Object.hasOwn(comparisonFields, 'recordCount')))
        const validStringPolicy =
          !hasStringPolicy ||
          (object(payload) &&
            payload.jsonStringPolicy === 'source-excerpts' &&
            options.historicalExcerptPolicy === 'typed-comparison-v24' &&
            legacyExcerptLabels &&
            options.normalizeSourceEnum === true &&
            Array.isArray(variants) &&
            variants.length === 2 &&
            object(comparisonFields) &&
            Object.hasOwn(comparisonFields, 'evidence'))
        if (
          !disposed &&
          armed &&
          object(message) &&
          Number.isSafeInteger(message.id) &&
          message.op === 'llm.generateRaw' &&
          object(payload) &&
          payload.background !== true &&
          payload.noThink !== false &&
          validStringPolicy &&
          expectedSchemaIdentities.includes(schemaIdentity(payload.jsonSchema)) &&
          pending.size < 32
        ) {
          watched = message.id as number
          const check = object(properties) ? properties.check : undefined
          // Exact request admission above remains authoritative. The opt-in is
          // limited to the current check→result contract, not historical shapes.
          const sourceLabelShapes =
            options.captureSourceLabelShapes === true &&
            options.normalizeSourceEnum === true &&
            object(properties) &&
            JSON.stringify(Object.keys(properties)) === '["check","result"]' &&
            object(check) &&
            JSON.stringify(check) === '{"type":"string","minLength":1,"maxLength":120}' &&
            object(schema) &&
            JSON.stringify(schema.required) === '["check","result"]'
          pending.set(watched, {
            caseId: armed,
            startedAt: Date.now(),
            sourceLabelShapes,
            legacyExcerptLabels,
            budgetedExcerptCounts,
            ...(hasStringPolicy ? { requestedJsonStringPolicy: 'source-excerpts' as const } : {}),
          })
          pendingCount++
          armed = null
        }
      } catch {
        observerErrors++
      }
      try {
        return Reflect.apply(originalPost, this, postArgs)
      } catch (error) {
        if (watched !== undefined && pending.delete(watched)) pendingCount--
        throw error
      }
    }
    function onMessage(value: unknown) {
      try {
        const message = unwrap(value)
        if (!object(message) || 'ev' in message || typeof message.id !== 'number') return
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        pendingCount--
        const started = Date.now()
        const row: Record<string, unknown> = {
          worker,
          requestId: message.id,
          caseId: request.caseId,
          elapsedMs: started - request.startedAt,
          ...(request.requestedJsonStringPolicy
            ? { requestedJsonStringPolicy: request.requestedJsonStringPolicy }
            : {}),
        }
        if (
          message.ok === true &&
          object(message.result) &&
          typeof message.result.raw === 'string'
        ) {
          try {
            row.capture = sanitize(
              message.result.raw,
              request.sourceLabelShapes ||
                request.legacyExcerptLabels ||
                request.budgetedExcerptCounts
                ? {
                    ...(request.sourceLabelShapes ? { sourceLabelShapes: true } : {}),
                    ...(request.legacyExcerptLabels ? { legacyExcerptLabels: true } : {}),
                    ...(request.budgetedExcerptCounts ? { budgetedExcerptCounts: true } : {}),
                  }
                : undefined,
            )
            row.status = 'completed'
          } catch {
            observerErrors++
            row.status = 'observer-error'
          }
        } else row.status = message.ok === false ? 'worker-error' : 'malformed-response'
        row.observerMs = Date.now() - started
        retain(row)
      } catch {
        observerErrors++
      }
    }
    function onExit() {
      for (const [requestId, request] of pending)
        retain({
          worker,
          requestId,
          caseId: request.caseId,
          status: 'worker-exited',
          ...(request.requestedJsonStringPolicy
            ? { requestedJsonStringPolicy: request.requestedJsonStringPolicy }
            : {}),
        })
      pendingCount -= pending.size
      pending.clear()
      cleanup()
    }
    function cleanup() {
      try {
        child.removeListener('message', onMessage)
        child.removeListener('exit', onExit)
      } catch {
        observerErrors++
      }
      try {
        if (child.postMessage === postMessage) child.postMessage = originalPost
      } catch {
        observerErrors++
      }
      pendingCount -= pending.size
      pending.clear()
      cleanups.delete(cleanup)
    }
    try {
      child.postMessage = postMessage
      if (child.postMessage !== postMessage) throw new Error('Observer method unavailable')
      child.on('message', onMessage)
      child.on('exit', onExit)
      cleanups.add(cleanup)
    } catch {
      observerErrors++
      cleanup()
    }
    return child
  }
  utilityProcess.fork = fork
  if (utilityProcess.fork !== fork) throw new Error('Synthetic observer installation failed')
  return {
    arm(caseId: string) {
      if (disposed || armed || pendingCount || !/^[A-Za-z0-9._-]{1,100}$/.test(caseId))
        throw new Error('Invalid synthetic observer admission')
      armed = caseId
    },
    drain() {
      return rows.splice(0)
    },
    disarm() {
      armed = null
    },
    status() {
      return {
        workers,
        observerErrors,
        dropped,
        pending: pendingCount,
        armed: armed !== null,
        disposed,
      }
    },
    dispose() {
      disposed = true
      armed = null
      try {
        if (utilityProcess.fork === fork) utilityProcess.fork = originalFork
      } catch {
        observerErrors++
      }
      for (const cleanup of [...cleanups]) cleanup()
    },
  }
}
