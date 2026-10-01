import type { QuizGenerationEvent } from '@shared/quiz'

/** Single-stage pipeline: units are planned in code (instant), then questions
 *  stream in. The timeline machinery is kept generic but only ever holds the
 *  one writing phase now. */
export type QuizPhaseName = 'generating-questions'

/** One phase in the per-deck timeline. `endedAt` is set once the next phase
 *  opens; the still-open (active) phase leaves it undefined. */
export interface QuizPhase {
  phase: QuizPhaseName
  startedAt: number
  endedAt?: number
}

/** Live generation progress for one deck, derived in QuizView from the
 *  QuizGenerationEvent stream. Undefined until the first event arrives. */
export interface QuizProgress {
  stage: QuizPhaseName
  /** questions accepted so far — no total; the model decides per unit. */
  ordinal?: number
  /** which unit (section) is being written. */
  unitTitle?: string
  unitIndex?: number
  unitTotal?: number
  /** epoch ms when the first event for this deck arrived (live timer base). */
  startedAt?: number
  /** ordered, closed+open phases for the step timeline. */
  timeline?: QuizPhase[]
}

/** Human-readable duration: `Ns` under a minute, else `m:ss`. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

/** `mm:ss` clock for the live elapsed timer. */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Open a new phase in the timeline, closing the currently-open one (if it
 *  differs). Same-phase events just keep the existing open phase. */
function advanceTimeline(timeline: QuizPhase[], phase: QuizPhaseName, at: number): QuizPhase[] {
  const open = timeline[timeline.length - 1]
  if (open && open.endedAt == null && open.phase === phase) return timeline
  const next = timeline.map((p, i) =>
    i === timeline.length - 1 && p.endedAt == null ? { ...p, endedAt: at } : p,
  )
  next.push({ phase, startedAt: at })
  return next
}

/** Fold one generation event into the running per-deck progress. Pure so it can
 *  be unit-tested; `now` is injected for determinism. Returns `null` for events
 *  that don't update progress (done/error/warning are handled by the caller). */
export function reduceProgress(
  prev: QuizProgress | undefined,
  ev: QuizGenerationEvent,
  now: number,
): QuizProgress | null {
  const startedAt = prev?.startedAt ?? now
  const timeline = advanceTimeline(prev?.timeline ?? [], 'generating-questions', now)
  switch (ev.type) {
    case 'plan':
      return {
        ...prev,
        stage: 'generating-questions',
        ordinal: prev?.ordinal ?? 0,
        unitTotal: ev.unitCount,
        startedAt,
        timeline,
      }
    case 'unit':
      return {
        ...prev,
        stage: 'generating-questions',
        unitTitle: ev.unitTitle,
        unitIndex: ev.unitIndex,
        unitTotal: ev.unitTotal,
        startedAt,
        timeline,
      }
    case 'question':
      return {
        ...prev,
        stage: 'generating-questions',
        ordinal: ev.ordinal,
        ...(ev.unitTitle != null ? { unitTitle: ev.unitTitle } : {}),
        ...(ev.unitIndex != null ? { unitIndex: ev.unitIndex } : {}),
        ...(ev.unitTotal != null ? { unitTotal: ev.unitTotal } : {}),
        startedAt,
        timeline,
      }
    default:
      return null
  }
}
