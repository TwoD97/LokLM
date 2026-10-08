import type { Api } from '../../../src/preload'
import type { StreamEvent } from '../../../src/shared/documents'

type CaptureApi = {
  chat: Pick<Api['chat'], 'stream' | 'cancel' | 'onEvent'>
  models: Pick<Api['models'], 'onActivity'>
}

type CapturedObservation = Awaited<ReturnType<typeof collectCalibrationStream>>

/** Only a settled, unambiguous error can be observed and then left behind safely. */
export function calibrationCollectionDecision(
  observation: CapturedObservation,
  continueErrors = false,
): 'complete' | 'continue-error' | 'stop' {
  if (
    !observation.terminalReceived ||
    !observation.invokeSettled ||
    observation.invokeError !== null ||
    observation.terminalMismatch ||
    observation.timedOut ||
    observation.cancellationError !== null
  )
    return 'stop'
  const terminals = observation.events.filter(
    (event) => event.type === 'done' || event.type === 'error',
  )
  if (terminals.length !== 1) return 'stop'
  if (observation.terminalOutcome === 'completed' && terminals[0]?.type === 'done')
    return 'complete'
  if (continueErrors && observation.terminalOutcome === 'error' && terminals[0]?.type === 'error')
    return 'continue-error'
  return 'stop'
}

/** Self-contained browser function, passed directly to page.evaluate. Keep all
 * runtime helpers inside its body; imports above are erased types only. */
export async function collectCalibrationStream(
  input: {
    id: number
    entry: { id: string; question: string; language: 'en' | 'de' }
    repetition: number
    timeoutMs?: number
    terminalGraceMs?: number
    cancellationGraceMs?: number
    wholeDocFallback?: boolean
  },
  injectedApi?: CaptureApi,
) {
  const api = injectedApi ?? (globalThis as unknown as { api: CaptureApi }).api
  const { id, entry, repetition } = input
  const streamId = `calibration-${entry.id}-${repetition}`
  const events: StreamEvent[] = []
  const eventTimes: Array<{ type: string; elapsedMs: number }> = []
  const modelActivities: Array<{ elapsedMs: number; activity: unknown }> = []
  let firstTokenAt: number | null = null
  let firstVisibleTokenAt: number | null = null
  let terminalAt: number | null = null
  let final: Extract<StreamEvent, { type: 'done' | 'error' }> | undefined
  let terminalOrigin: 'event' | 'invoke' | null = null
  let terminalMismatch = false
  let timedOut = false
  let invokeSettled = false
  let invokeError: string | null = null
  let cancellationError: string | null = null
  let finished = false
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  const started = performance.now()
  const accept = (event: StreamEvent, origin: 'event' | 'invoke') => {
    if (finished) return
    if (event.type === 'done' || event.type === 'error') {
      if (final) {
        if (JSON.stringify(final) !== JSON.stringify(event)) terminalMismatch = true
        else return // Same terminal delivered by push and invoke is expected.
      }
      final = event
      terminalOrigin = origin
      terminalAt ??= performance.now()
      resolveTerminal()
    }
    events.push(event)
    eventTimes.push({ type: event.type, elapsedMs: Math.round(performance.now() - started) })
    if (event.type === 'token' && firstTokenAt === null) firstTokenAt = performance.now()
    if (event.type === 'token' && firstVisibleTokenAt === null && event.text.trim())
      firstVisibleTokenAt = performance.now()
  }
  const offActivity = api.models.onActivity((activity) => {
    if (!finished)
      modelActivities.push({ elapsedMs: Math.round(performance.now() - started), activity })
  })
  const off = api.chat.onEvent(streamId, (event) => accept(event, 'event'))
  const timeoutMs = input.timeoutMs ?? 180_000
  const timer = setTimeout(() => {
    timedOut = true
    void api.chat.cancel(streamId).catch((error: unknown) => {
      cancellationError = error instanceof Error ? error.message : String(error)
    })
  }, timeoutMs)
  let hardTimer: ReturnType<typeof setTimeout> | undefined
  let terminalTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const invoked = Promise.resolve()
      .then(() =>
        api.chat.stream(streamId, id, entry.question, {
          language: entry.language,
          rerank: false,
          multiQuery: false,
          routing: false,
          wholeDocFallback: input.wholeDocFallback === true,
        }),
      )
      .then(
        (returned) => {
          invokeSettled = true
          if (returned) accept(returned, 'invoke')
        },
        (error: unknown) => {
          invokeSettled = true
          invokeError = error instanceof Error ? error.message : String(error)
        },
      )
    // Cancellation is cooperative. Bound a broken/non-settling invoke as well
    // so one failed case cannot consume the entire calibration session.
    await Promise.race([
      invoked,
      new Promise<void>((resolve) => {
        hardTimer = setTimeout(resolve, timeoutMs + (input.cancellationGraceMs ?? 10_000))
      }),
    ])
    if (invokeSettled && !final && !invokeError) {
      await Promise.race([
        terminal,
        new Promise<void>((resolve) => {
          terminalTimer = setTimeout(resolve, input.terminalGraceMs ?? 5000)
        }),
      ])
    }
    const terminalEvent = final as Extract<StreamEvent, { type: 'done' | 'error' }> | undefined
    const streamed = events
      .filter((event) => event.type === 'token')
      .map((event) => event.text)
      .join('')
    return {
      caseId: entry.id,
      question: entry.question,
      language: entry.language,
      repetition,
      ttftMs: firstTokenAt === null ? null : Math.round(firstTokenAt - started),
      firstVisibleTokenMs:
        firstVisibleTokenAt === null ? null : Math.round(firstVisibleTokenAt - started),
      terminalMs: terminalAt === null ? null : Math.round(terminalAt - started),
      totalMs: Math.round(performance.now() - started),
      events,
      eventTimes,
      modelActivities,
      answer: terminalEvent?.full_text ?? streamed,
      citations: terminalEvent?.citations ?? [],
      timedOut,
      terminalReceived: !!terminalEvent,
      terminalOrigin: terminalOrigin as 'event' | 'invoke' | null,
      terminalMismatch,
      terminalOutcome:
        terminalEvent?.type === 'error'
          ? 'error'
          : (terminalEvent?.outcome ?? (terminalEvent ? 'completed' : null)),
      invokeSettled,
      // Assigned inside asynchronous callbacks; preserve their public union
      // instead of TypeScript narrowing the captured variables to initial null.
      invokeError: invokeError as string | null,
      cancellationError: cancellationError as string | null,
    }
  } finally {
    finished = true
    clearTimeout(timer)
    if (hardTimer) clearTimeout(hardTimer)
    if (terminalTimer) clearTimeout(terminalTimer)
    off()
    offActivity()
  }
}
