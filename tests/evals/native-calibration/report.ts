import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { extractCitationMarkers } from '../../../src/shared/citationMarkers'
import type { CalibrationManifest, CalibrationSplit } from './schema'

type Citation = { doc_id: number; chunk_id: number; score?: number }
type Info = Record<string, unknown>

export interface NativeQueryObservation {
  caseId: string
  question: string
  language: string
  repetition: number
  ttftMs: number | null
  firstVisibleTokenMs?: number | null
  totalMs: number | null
  answer: string
  citations: Citation[]
  events: Array<{ type: string; [key: string]: unknown }>
  beforeInfo?: Info
  afterInfo?: Info
  modelActivities?: Array<{ elapsedMs: number; activity: unknown }>
  timedOut: boolean
  terminalReceived?: boolean
  terminalOutcome?: 'completed' | 'cancelled' | 'error' | null
  terminalMismatch?: boolean
  invokeSettled?: boolean
  invokeError?: string | null
  terminalMs?: number | null
  logs?: string[]
}

export interface NativeCalibrationRun {
  kind: 'native-rag-calibration'
  runId: string
  split: CalibrationSplit
  requestedContext: number
  documents: Array<{
    sourceKey: string
    id: number
    chunks: Array<{ id: number; text: string }>
  }>
  queries: NativeQueryObservation[]
  [key: string]: unknown
}

export interface ManualReview {
  caseId: string
  repetition: number
  verdict:
    | 'supported'
    | 'partial'
    | 'unsupported'
    | 'incorrect'
    | 'false-refusal'
    | 'safe-abstention'
    | 'unclear'
  citationSupport: 'supported' | 'unsupported' | 'missing' | 'not-applicable' | 'unclear'
  citationCompleteness?: 'complete' | 'partial' | 'none' | 'not-applicable'
  /** Judge the actual supplied text, independently of source-document presence. */
  contextSufficiency?: 'sufficient' | 'missing-evidence' | 'unresolved-conflict' | 'unclear'
  decisionCorrectness?: 'correct' | 'incorrect' | 'unclear'
  unsupportedExtraClaims: string[]
  notes: string
}

const markerPattern = /\[doc:\s*(\d+)\s*,\s*chunk:\s*(\d+)\s*\]/gu
const key = (c: Citation): string => `${c.doc_id}:${c.chunk_id}`

function citationsInAnswer(answer: string): Citation[] {
  return extractCitationMarkers(answer).map((marker) => ({
    doc_id: marker.documentId,
    chunk_id: marker.chunkId,
  }))
}

function record(value: unknown): Info {
  return value !== null && typeof value === 'object' ? (value as Info) : {}
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function allocation(info: Info | undefined) {
  const llm = record(info?.llm)
  const capacity = record(llm.modelCapacity)
  const plan = record(llm.lastLlmPlan)
  return {
    profile: typeof llm.profile === 'string' ? llm.profile : null,
    kvCacheType: typeof plan.kvCacheType === 'string' ? plan.kvCacheType : null,
    contextTokens: finite(capacity.contextSize) ?? finite(plan.contextSize),
    gpuLayers: finite(capacity.gpuLayers),
    totalModelLayers: finite(capacity.totalModelLayers),
    fullyOnGpu: typeof capacity.fullyOnGpu === 'boolean' ? capacity.fullyOnGpu : null,
  }
}

export function describeTimings(values: Array<number | null>) {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  const at = (fraction: number): number | null =>
    sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]! : null
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2
    : null
  return { n: sorted.length, minMs: sorted[0] ?? null, p50Ms: median, p95Ms: at(0.95) }
}

/** Diagnostic coverage only: source counts and a model label do not certify correctness. */
export function describeEvidenceAssessment(
  logs: string[],
  events: Array<{ type: string; [key: string]: unknown }>,
) {
  // Electron's console inspector colors booleans, numbers and quoted strings.
  // Preserve raw logs in the run; normalize only this derived diagnostic view.
  const text = stripVTControlCharacters(logs.join('\n'))
  const coverage = /\[qa\] evidence coverage:\s*\{([^}]+)\}/u.exec(text)?.[1]
  const planned = coverage?.match(/\bplanned:\s*(true|false)/u)?.[1]
  const relation = /\[qa\] evidence assessment:\s*\{\s*relation:\s*['"]([^'"]+)['"]/u.exec(
    text,
  )?.[1]
  const stages = events.filter((event) => event.type === 'stage' && event.stage === 'evidence')
  return {
    coverageLogged: coverage !== undefined,
    planned: planned === undefined ? null : planned === 'true',
    passages: coverage ? Number(/\bpassages:\s*(\d+)/u.exec(coverage)?.[1] ?? NaN) || null : null,
    documents: coverage ? Number(/\bdocuments:\s*(\d+)/u.exec(coverage)?.[1] ?? NaN) || null : null,
    relation: relation ?? null,
    stageStarted: stages.some((event) => event.status === 'start'),
    stageCompleted: stages.some((event) => event.status === 'done'),
    durationMs: finite(stages.find((event) => event.status === 'done')?.durationMs),
  }
}

/** Mechanical checks expose evidence for review; they never certify semantic grounding. */
export function gradeNativeRun(
  run: NativeCalibrationRun,
  manifest: CalibrationManifest,
  manual: ManualReview[] = [],
) {
  if (run.kind !== 'native-rag-calibration' || run.split !== manifest.split)
    throw new Error('Raw run and calibration manifest do not match.')
  const cases = new Map(manifest.cases.map((c) => [c.id, c]))
  const configuredSelection = record(run.configuration).selectedCases
  const requested = configuredSelection ?? manifest.cases.map((entry) => entry.id)
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.some((id) => typeof id !== 'string' || !cases.has(id)) ||
    new Set(requested).size !== requested.length
  )
    throw new Error('Invalid requested calibration cases.')
  const requestedCaseIds = requested as string[]
  if (run.queries.some((query) => !requestedCaseIds.includes(query.caseId)))
    throw new Error('Observed query was not requested.')
  const documents = new Map(run.documents.map((d) => [d.sourceKey, d]))
  const importedPairs = new Set(
    run.documents.flatMap((d) => d.chunks.map((c) => `${d.id}:${c.id}`)),
  )
  const passages = new Map<
    string,
    { sourceKey: string; documentId: number; chunkId: number; text: string }
  >(
    run.documents.flatMap((document) =>
      document.chunks.map(
        (chunk) =>
          [
            `${document.id}:${chunk.id}`,
            {
              sourceKey: document.sourceKey,
              documentId: document.id,
              chunkId: chunk.id,
              text: chunk.text,
            },
          ] as const,
      ),
    ),
  )
  const manualByQuery = new Map(manual.map((m) => [`${m.caseId}:${m.repetition}`, m]))
  if (manualByQuery.size !== manual.length) throw new Error('Duplicate manual review entries.')
  const queries = run.queries.map((query) => {
    const gold = cases.get(query.caseId)
    if (!gold) throw new Error(`Unknown calibration case: ${query.caseId}`)
    const citationEvents = query.events.filter((event) => event.type === 'citation')
    const fed: Citation[] = citationEvents.length
      ? citationEvents.map((event) => ({
          doc_id: Number(event.doc_id),
          chunk_id: Number(event.chunk_id),
        }))
      : query.citations
    const fedPairs = new Set(fed.map(key))
    const inlineCitations = citationsInAnswer(query.answer)
    const invalidInlineCitations = inlineCitations.filter((c) => !fedPairs.has(key(c)))
    const unknownFedCitations = fed.filter((c) => !importedPairs.has(key(c)))
    const answerWithoutMarkers = query.answer.replace(markerPattern, '')
    const factChecks = gold.answerChecks.map((check) => ({
      label: check.label,
      matched: new RegExp(check.pattern, 'iu').test(answerWithoutMarkers),
    }))
    const forbiddenMatches = (gold.forbiddenPatterns ?? []).filter((pattern) =>
      new RegExp(pattern, 'iu').test(answerWithoutMarkers),
    )
    const sourceCoverage = gold.requiredSourceKeys.map((sourceKey) => {
      const doc = documents.get(sourceKey)
      return {
        sourceKey,
        imported: !!doc,
        supplied: !!doc && fed.some((c) => c.doc_id === doc.id),
        citedInline: !!doc && inlineCitations.some((c) => c.doc_id === doc.id),
      }
    })
    const errors = query.events
      .filter((event) => event.type === 'error')
      .map((event) => String(event.message ?? 'Unknown stream error'))
    const programmaticRefusal = query.events.some((event) => event.type === 'refusal')
    const terminalEvent =
      query.events.find((event) => event.type === 'done' || event.type === 'error')?.type ?? null
    const terminalOutcome =
      query.terminalOutcome ??
      (terminalEvent === 'error'
        ? 'error'
        : (query.events.find((event) => event.type === 'done')?.outcome ??
          (terminalEvent ? 'completed' : null)))
    // A cue is only a review aid: a model can state "not specified" and still
    // invent another fact, or safely explain a conflict without a refusal cue.
    const abstentionCue =
      /\b(not (?:provided|specified|stated|available|mentioned)|cannot (?:determine|answer|confirm)|insufficient|conflicting|contradictory|nicht (?:angegeben|genannt|enthalten|verfügbar|belegt)|keine (?:Angabe|Information)|widersprüchlich|widersprechen)\b/iu.test(
        answerWithoutMarkers,
      )
    const before = allocation(query.beforeInfo)
    const after = allocation(query.afterInfo)
    const reviewFlags: string[] = []
    if (query.timedOut) reviewFlags.push('timed-out')
    if (errors.length) reviewFlags.push('stream-error')
    if (query.invokeError) reviewFlags.push('invoke-error')
    if (query.invokeSettled === false) reviewFlags.push('invoke-did-not-settle')
    if (query.terminalMismatch) reviewFlags.push('terminal-channel-mismatch')
    if (terminalOutcome === 'cancelled') reviewFlags.push('cancelled-answer')
    if (!terminalEvent) reviewFlags.push('terminal-event-not-observed')
    if (!query.answer.trim()) reviewFlags.push('empty-answer')
    if (invalidInlineCitations.length) reviewFlags.push('citation-outside-supplied-evidence')
    if (unknownFedCitations.length) reviewFlags.push('supplied-citation-not-in-imported-corpus')
    if (sourceCoverage.some((source) => !source.imported))
      reviewFlags.push('required-source-not-imported')
    if (sourceCoverage.some((source) => !source.supplied))
      reviewFlags.push('required-source-not-supplied')
    if (sourceCoverage.some((source) => !source.citedInline))
      reviewFlags.push('required-source-not-cited-inline')
    if (factChecks.some((check) => !check.matched))
      reviewFlags.push('expected-fact-pattern-missing')
    if (forbiddenMatches.length) reviewFlags.push('forbidden-pattern-matched')
    if (!gold.expectedAbstention && programmaticRefusal) reviewFlags.push('possible-false-refusal')
    if (gold.expectedAbstention && !programmaticRefusal && !abstentionCue)
      reviewFlags.push('abstention-needs-manual-confirmation')
    if (after.contextTokens === null) reviewFlags.push('actual-context-unrecorded')
    else if (after.contextTokens !== run.requestedContext)
      reviewFlags.push('actual-context-mismatch')
    const manualReview = manualByQuery.get(`${query.caseId}:${query.repetition}`) ?? null
    return {
      caseId: query.caseId,
      repetition: query.repetition,
      kind: gold.kind,
      challengeCategory: gold.challengeCategory ?? null,
      language: query.language,
      expectedAbstention: gold.expectedAbstention,
      referenceAnswer: gold.referenceAnswer,
      answer: query.answer,
      factChecks,
      forbiddenMatches,
      sourceCoverage,
      suppliedCitations: fed,
      evidenceAssessment: describeEvidenceAssessment(query.logs ?? [], query.events),
      suppliedPassages: [...new Set(fed.map(key))].map(
        (pair) => passages.get(pair) ?? { missingPair: pair },
      ),
      inlineCitations,
      invalidInlineCitations,
      unknownFedCitations,
      programmaticRefusal,
      terminalEvent,
      terminalOutcome,
      invokeError: query.invokeError ?? null,
      abstentionCue,
      errors,
      timedOut: query.timedOut,
      ttftMs: finite(query.ttftMs),
      firstVisibleTokenMs: finite(query.firstVisibleTokenMs),
      totalMs: finite(query.totalMs),
      terminalMs: finite(query.terminalMs),
      modelActivities: query.modelActivities ?? null,
      allocationBefore: before,
      allocationAfter: after,
      reviewFlags,
      mechanicalChecksPassed: reviewFlags.length === 0,
      manualReview,
      manualReviewRequired: manualReview === null,
    }
  })
  return {
    kind: 'native-rag-calibration-review' as const,
    runId: run.runId,
    split: run.split,
    requestedContext: run.requestedContext,
    limitations: [
      'Small synthetic document-disjoint sample, not representative accuracy or a calibrated confidence score.',
      'Regex presence does not establish factual correctness, citation support, or absence of unsupported extra claims.',
      'Supplied citation membership validates provenance only; semantic support requires manual review of source text.',
      'Timing includes the measured request path and model handoffs; later requests are not assumed fully warm.',
      'p50 uses the conventional median (mean of the two central values for even samples); p95 uses nearest rank. Both are descriptive only for small samples.',
      'Requested context is reported separately from each query’s recorded allocation.',
    ],
    provenance: {
      gitCommit: run.gitCommit ?? null,
      configuration: run.configuration ?? null,
      sourceHashes: run.sourceHashes ?? null,
      sourceHashesMeaning:
        run.sourceHashesMeaning ??
        'Working-tree files observed at run start; correspondence to compiled output is not established without a matching build-time manifest.',
      compiledBuildHashes: run.compiledBuildHashes ?? null,
      compiledBuildHashesAfter: run.compiledBuildHashesAfter ?? null,
      buildProvenance: run.buildProvenance ?? { status: 'unknown', reason: 'not-recorded' },
      buildProvenanceAfter: run.buildProvenanceAfter ?? null,
      fixtureSha256: run.fixtureSha256 ?? null,
      documentHashes: run.documents.map((document) => ({
        sourceKey: document.sourceKey,
        sha256: record(document).sourceSha256 ?? null,
      })),
      models: run.models ?? null,
      hardware: run.hardware ?? null,
      peakGpuUsedMiB: run.peakGpuUsedMiB ?? null,
      startupMs: run.startupMs ?? null,
      indexingMs: run.indexingMs ?? null,
    },
    summary: {
      observedQueries: queries.length,
      manifestCases: manifest.cases.length,
      expectedCases: requestedCaseIds.length,
      requestedCaseIds,
      unrequestedCaseIds: manifest.cases
        .filter((entry) => !requestedCaseIds.includes(entry.id))
        .map((entry) => entry.id),
      unobservedCaseIds: requestedCaseIds.filter(
        (id) => !queries.some((query) => query.caseId === id),
      ),
      mechanicalPasses: queries.filter((q) => q.mechanicalChecksPassed).length,
      manuallyReviewed: queries.filter((q) => !q.manualReviewRequired).length,
      manualVerdicts: Object.fromEntries(
        [...new Set(manual.map((m) => m.verdict))].map((verdict) => [
          verdict,
          queries.filter((q) => q.manualReview?.verdict === verdict).length,
        ]),
      ),
      timedOut: queries.filter((q) => q.timedOut).length,
      streamErrors: queries.filter((q) => q.errors.length).length,
      ttft: describeTimings(queries.map((q) => q.ttftMs)),
      firstVisibleToken: describeTimings(queries.map((q) => q.firstVisibleTokenMs)),
      total: describeTimings(queries.map((q) => q.totalMs)),
      byRepetition: Object.fromEntries(
        [...new Set(queries.map((q) => q.repetition))].map((repetition) => {
          const subset = queries.filter((q) => q.repetition === repetition)
          return [
            repetition,
            {
              observedQueries: subset.length,
              manuallyReviewed: subset.filter((q) => !q.manualReviewRequired).length,
              manualVerdicts: Object.fromEntries(
                [...new Set(subset.map((q) => q.manualReview?.verdict).filter(Boolean))].map(
                  (verdict) => [
                    verdict,
                    subset.filter((q) => q.manualReview?.verdict === verdict).length,
                  ],
                ),
              ),
              ttft: describeTimings(subset.map((q) => q.ttftMs)),
              firstVisibleToken: describeTimings(subset.map((q) => q.firstVisibleTokenMs)),
              total: describeTimings(subset.map((q) => q.totalMs)),
            },
          ]
        }),
      ),
    },
    queries,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag)
    return index < 0 ? undefined : args[index + 1]
  }
  const rawPath = value('--raw')
  const manifestPath = value('--manifest')
  const outputPath = value('--out')
  if (!rawPath || !manifestPath || !outputPath)
    throw new Error(
      'Usage: report.ts --raw raw.json --manifest dev.json --out review.json [--manual manual.json]',
    )
  const raw = JSON.parse(await readFile(rawPath, 'utf8')) as NativeCalibrationRun
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CalibrationManifest
  const manualPath = value('--manual')
  const manual = manualPath
    ? (JSON.parse(await readFile(manualPath, 'utf8')) as ManualReview[])
    : []
  const report = gradeNativeRun(raw, manifest, manual)
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report.summary, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
