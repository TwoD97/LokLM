import { stripVTControlCharacters } from 'node:util'

export type BoundedThoughtStatus = {
  status: 'active' | 'unsupported_wrapper' | 'setup_failed'
  maxThoughtTokens: 64 | 128 | 0
}

export type BoundedThoughtCounters = {
  promptTokens: number
  prefillBatches: number
  prefillTokens: number
  thoughtTokens: number
  thoughtClosingTokens: number
  forcedClosingTokens: number
  visibleTokens: number
  combinedTokens: number
  firstVisibleMs: number | null
  lastVisibleMs: number | null
  thoughtTermination: 'natural' | 'budget' | null
}

const completionReasons = [
  'abort',
  'maxTokens',
  'eogToken',
  'stopGenerationTrigger',
  'functionCalls',
  'customStopTrigger',
  'unknown',
] as const

export type BoundedThoughtMetrics = {
  task: 'title' | 'utility'
  route: 'main' | 'utility'
  elapsedMs: number
  grammarMs: number
  promptFitMs: number | null
  nativeMs: number | null
  firstTextMs: number | null
  lastTextMs: number | null
  firstNonWhitespaceTextMs: number | null
  lastNonWhitespaceTextMs: number | null
  responseChars: number
  responseChunks: number
  completionReason: (typeof completionReasons)[number] | null
  cancelled: boolean
  usedInputTokens?: number
  usedOutputTokens?: number
  boundedThoughts: BoundedThoughtCounters
}

const counterKeys = [
  'promptTokens',
  'prefillBatches',
  'prefillTokens',
  'thoughtTokens',
  'thoughtClosingTokens',
  'forcedClosingTokens',
  'visibleTokens',
  'combinedTokens',
] as const
const nullableTimingKeys = [
  'promptFitMs',
  'nativeMs',
  'firstTextMs',
  'lastTextMs',
  'firstNonWhitespaceTextMs',
  'lastNonWhitespaceTextMs',
] as const
const boundedKeys = [...counterKeys, 'firstVisibleMs', 'lastVisibleMs', 'thoughtTermination']
const metricKeys = [
  'task',
  'route',
  'elapsedMs',
  'grammarMs',
  ...nullableTimingKeys,
  'responseChars',
  'responseChunks',
  'completionReason',
  'cancelled',
  'usedInputTokens',
  'usedOutputTokens',
  'boundedThoughts',
]

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function timing(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function nullableTiming(value: unknown): value is number | null {
  return value === null || timing(value)
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function parseStatus(value: unknown): BoundedThoughtStatus | null {
  if (!record(value) || !onlyKeys(value, ['status', 'maxThoughtTokens'])) return null
  if (
    value.status === 'active' &&
    (value.maxThoughtTokens === 64 || value.maxThoughtTokens === 128)
  )
    return { status: value.status, maxThoughtTokens: value.maxThoughtTokens }
  if (
    (value.status === 'unsupported_wrapper' || value.status === 'setup_failed') &&
    value.maxThoughtTokens === 0
  )
    return { status: value.status, maxThoughtTokens: 0 }
  return null
}

function parseMetrics(value: Record<string, unknown>): BoundedThoughtMetrics | null {
  const bounded = value.boundedThoughts
  if (
    !onlyKeys(value, metricKeys) ||
    !record(bounded) ||
    !onlyKeys(bounded, boundedKeys) ||
    !counterKeys.every((key) => count(bounded[key])) ||
    (bounded.thoughtTokens as number) > 128 ||
    !nullableTiming(bounded.firstVisibleMs) ||
    !nullableTiming(bounded.lastVisibleMs) ||
    (bounded.thoughtTermination !== null &&
      bounded.thoughtTermination !== 'natural' &&
      bounded.thoughtTermination !== 'budget') ||
    (value.task !== 'title' && value.task !== 'utility') ||
    (value.route !== 'main' && value.route !== 'utility') ||
    !timing(value.elapsedMs) ||
    !timing(value.grammarMs) ||
    !nullableTimingKeys.every((key) => nullableTiming(value[key])) ||
    !count(value.responseChars) ||
    !count(value.responseChunks) ||
    typeof value.cancelled !== 'boolean' ||
    (value.completionReason !== null &&
      !completionReasons.some((reason) => reason === value.completionReason)) ||
    (Object.hasOwn(value, 'usedInputTokens') && !count(value.usedInputTokens)) ||
    (Object.hasOwn(value, 'usedOutputTokens') && !count(value.usedOutputTokens))
  )
    return null

  // Copy named scalars only. Never spread parsed log objects into artifacts.
  return {
    task: value.task,
    route: value.route,
    elapsedMs: value.elapsedMs,
    grammarMs: value.grammarMs,
    promptFitMs: value.promptFitMs as number | null,
    nativeMs: value.nativeMs as number | null,
    firstTextMs: value.firstTextMs as number | null,
    lastTextMs: value.lastTextMs as number | null,
    firstNonWhitespaceTextMs: value.firstNonWhitespaceTextMs as number | null,
    lastNonWhitespaceTextMs: value.lastNonWhitespaceTextMs as number | null,
    responseChars: value.responseChars,
    responseChunks: value.responseChunks,
    completionReason: value.completionReason as BoundedThoughtMetrics['completionReason'],
    cancelled: value.cancelled,
    ...(count(value.usedInputTokens) ? { usedInputTokens: value.usedInputTokens } : {}),
    ...(count(value.usedOutputTokens) ? { usedOutputTokens: value.usedOutputTokens } : {}),
    boundedThoughts: {
      promptTokens: bounded.promptTokens as number,
      prefillBatches: bounded.prefillBatches as number,
      prefillTokens: bounded.prefillTokens as number,
      thoughtTokens: bounded.thoughtTokens as number,
      thoughtClosingTokens: bounded.thoughtClosingTokens as number,
      forcedClosingTokens: bounded.forcedClosingTokens as number,
      visibleTokens: bounded.visibleTokens as number,
      combinedTokens: bounded.combinedTokens as number,
      firstVisibleMs: bounded.firstVisibleMs,
      lastVisibleMs: bounded.lastVisibleMs,
      thoughtTermination: bounded.thoughtTermination,
    },
  }
}

/** Observed worker status/counters only; a request or QA stage does not prove
 * that the adapter ran. No generated/private text or arbitrary error survives. */
export function describeBoundedThoughts(logs: readonly string[]) {
  const statuses: BoundedThoughtStatus[] = []
  const metrics: BoundedThoughtMetrics[] = []
  let malformedStatusLogs = 0
  let malformedMetricsLogs = 0
  for (const entry of logs) {
    for (const line of stripVTControlCharacters(entry).split(/\r?\n/u)) {
      const match =
        /^\s*(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3} > )?(?:\[modelsWorker\]\s*)?llm\.(boundedThoughts|generateRaw metrics):\s*(.*)$/u.exec(
          line,
        )
      if (!match) continue
      const isStatus = match[1] === 'boundedThoughts'
      try {
        // These records are small fixed metadata objects; avoid parsing an
        // accidental unbounded payload even though nothing is copied from it.
        if (match[2]!.length > 8192) throw new Error('Oversized diagnostic')
        const value: unknown = JSON.parse(match[2]!)
        if (isStatus) {
          const status = parseStatus(value)
          if (status) statuses.push(status)
          else malformedStatusLogs++
        } else if (record(value) && !Object.hasOwn(value, 'boundedThoughts')) {
          // Historical and ordinary raw generations are not bounded evidence.
          continue
        } else {
          const metric = record(value) ? parseMetrics(value) : null
          if (metric) metrics.push(metric)
          else malformedMetricsLogs++
        }
      } catch {
        if (isStatus) malformedStatusLogs++
        else malformedMetricsLogs++
      }
    }
  }
  return {
    activeLogged: statuses.some((entry) => entry.status === 'active'),
    unsupportedWrapperLogged: statuses.some((entry) => entry.status === 'unsupported_wrapper'),
    setupFailedLogged: statuses.some((entry) => entry.status === 'setup_failed'),
    statuses,
    metrics,
    malformedStatusLogs,
    malformedMetricsLogs,
  }
}
