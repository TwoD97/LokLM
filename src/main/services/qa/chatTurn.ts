import { reconcileCitations } from '../../../shared/citationMarkers'
import type { PipelineStep, StreamEvent } from '../../../shared/documents'

type TurnCitation = { doc_id: number; chunk_id: number; score: number }
type Metrics = { ttftMs: number | null; tokensPerSec: number | null; tokenCount: number }

export interface ChatTurnResult {
  content: string
  citations: TurnCitation[]
  outcome: 'completed' | 'cancelled' | 'failed'
  error?: string
  metrics: Metrics
  pipeline: PipelineStep[]
}

interface ChatTurnOptions {
  /** A factory avoids starting retrieval/model loading for a preflight cancellation. */
  stream: () => AsyncIterable<StreamEvent>
  signal: AbortSignal
  language: 'de' | 'en'
  emit: (event: StreamEvent) => void
  persist?: (turn: ChatTurnResult) => Promise<void>
}

const notes = {
  en: {
    cancelled: 'Answer interrupted.',
    failed: 'The answer could not be completed.',
    unsaved: 'This answer could not be saved.',
    incomplete: 'The answer stream ended without a completion event.',
  },
  de: {
    cancelled: 'Antwort wurde unterbrochen.',
    failed: 'Die Antwort konnte nicht abgeschlossen werden.',
    unsaved: 'Diese Antwort konnte nicht gespeichert werden.',
    incomplete: 'Der Antwortstream endete ohne Abschlussmeldung.',
  },
} as const

const withNote = (body: string, note: string): string => `${body}${body ? '\n\n' : ''}_[${note}]_`
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const citationKey = (citation: TurnCitation): string => `${citation.doc_id}-${citation.chunk_id}`

/** Collect one QA turn, persist its final state, then deliver exactly one terminal.
 * A provider's done payload is authoritative even when its streamed text differs.
 * Errors and cancellations preserve partial text with a durable, visible status.
 */
export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  const { signal, language, emit } = options
  const copy = notes[language]
  const started = performance.now()
  let firstTokenAt: number | null = null
  let tokenCount = 0
  const tokens: string[] = []
  const provided: TurnCitation[] = []
  const pipeline: PipelineStep[] = []
  let done: Extract<StreamEvent, { type: 'done' }> | undefined
  let refusal: string | undefined
  let failure: string | undefined

  try {
    if (!signal.aborted) {
      for await (const event of options.stream()) {
        if (signal.aborted) break
        if (event.type === 'done') {
          done = event
          break
        }
        if (event.type === 'error') {
          failure = event.message
          break
        }
        if (event.type === 'token') {
          tokens.push(event.text)
          firstTokenAt ??= performance.now()
          tokenCount += event.count ?? 1
        } else if (event.type === 'citation') {
          provided.push({ doc_id: event.doc_id, chunk_id: event.chunk_id, score: event.score })
        } else if (event.type === 'refusal') {
          refusal = event.message
        } else if (event.type === 'stage') {
          if (event.status === 'start') {
            pipeline.push({
              stage: event.stage,
              status: 'running',
              ...(event.detail !== undefined ? { detail: event.detail } : {}),
            })
          } else {
            for (let i = pipeline.length - 1; i >= 0; i--) {
              const step = pipeline[i]!
              if (step.stage !== event.stage || step.status !== 'running') continue
              pipeline[i] = {
                ...step,
                status: 'done',
                ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
                ...(event.detail !== undefined ? { detail: event.detail } : {}),
              }
              break
            }
          }
        }
        emit(event)
      }
    }
  } catch (error) {
    failure = errorText(error)
  }

  if (done && !done.full_text.trim()) failure ??= copy.incomplete
  const outcome =
    done && failure === undefined ? 'completed' : signal.aborted ? 'cancelled' : 'failed'
  if (outcome === 'failed') failure ??= copy.incomplete
  const body = done?.full_text.trim() ? done.full_text : tokens.join('') || refusal || ''
  const elapsed = firstTokenAt === null ? 0 : (performance.now() - firstTokenAt) / 1000
  const turn: ChatTurnResult = {
    content: outcome === 'completed' ? body : withNote(body, copy[outcome]),
    citations: reconcileCitations(body, done ? done.citations : provided, citationKey),
    outcome,
    ...(outcome === 'failed' ? { error: failure! } : {}),
    metrics: {
      ttftMs: firstTokenAt === null ? null : Math.round(firstTokenAt - started),
      tokensPerSec: tokenCount > 1 && elapsed > 0 ? tokenCount / elapsed : null,
      tokenCount,
    },
    pipeline,
  }
  let persisted = false
  try {
    if (options.persist) {
      await options.persist(turn)
      persisted = true
    }
  } catch (error) {
    turn.outcome = 'failed'
    turn.error = `${copy.unsaved} ${errorText(error)}`
    turn.content = withNote(turn.content, copy.unsaved)
  }

  const terminal: StreamEvent =
    turn.outcome === 'failed'
      ? {
          type: 'error',
          message: turn.error!,
          full_text: turn.content,
          citations: turn.citations,
          persisted,
        }
      : { type: 'done', full_text: turn.content, citations: turn.citations, outcome: turn.outcome }
  try {
    emit(terminal)
  } catch {
    /* The renderer disconnected; persistence already finished. */
  }
  return turn
}

/** Existing encrypted conversation store API; no message schema change needed. */
interface TurnStore {
  appendMessage(
    conversationId: number,
    role: 'assistant',
    content: string,
    metrics: Metrics,
    pipeline: PipelineStep[] | null,
  ): Promise<{ id: number }>
  persistCitations(
    messageId: number,
    citations: Array<{ chunk_id: number; score?: number | null }>,
  ): Promise<void>
  deleteMessage(messageId: number): Promise<void>
}

export async function persistChatTurn(
  store: TurnStore,
  conversationId: number,
  turn: ChatTurnResult,
): Promise<void> {
  const message = await store.appendMessage(
    conversationId,
    'assistant',
    turn.content,
    turn.metrics,
    turn.pipeline.length ? turn.pipeline : null,
  )
  try {
    if (turn.citations.length) await store.persistCitations(message.id, turn.citations)
  } catch (error) {
    // Avoid a success-looking row without its sources when the second write fails.
    try {
      await store.deleteMessage(message.id)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Could not save the answer sources or remove the incomplete saved answer.',
      )
    }
    throw error
  }
}
