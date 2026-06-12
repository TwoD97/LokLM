import { useEffect, useState } from 'react'
import {
  Plus,
  Play,
  RotateCcw,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
  X,
  Check,
} from 'lucide-react'
import type { QuizDeckSummary, QuizGenerationEvent } from '@shared/quiz'
import { QuizDeckHistory, scoreTone } from './QuizDeckHistory'
import { useT, type TFn } from '../i18n'

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

/** Units are the only known denominator (question count is the model's call),
 *  so the bar tracks completed units: the active unit counts once its first
 *  question lands. */
function progressPercent(p: QuizProgress): number {
  if (!p.unitTotal) return 4
  const done = Math.max(0, (p.unitIndex ?? 1) - 1)
  return Math.min(100, Math.round((done / p.unitTotal) * 100))
}

function stepLabel(_p: QuizProgress, t: TFn): string {
  return t('quiz.list.stepGenerating')
}

function stepDetail(p: QuizProgress, t: TFn): string | null {
  const parts: string[] = []
  if (p.unitTotal) {
    const title = p.unitTitle ? ` "${p.unitTitle}"` : ''
    parts.push(
      t('quiz.list.stepUnitProgress', { current: p.unitIndex ?? 0, total: p.unitTotal }) + title,
    )
  }
  if (p.ordinal) {
    parts.push(t('quiz.list.questions', { count: p.ordinal }))
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function phaseLabel(_phase: QuizPhaseName, _p: QuizProgress | undefined, t: TFn): string {
  return t('quiz.list.stepGenerating')
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

type Props = {
  decks: QuizDeckSummary[]
  /** deckId → live generation progress. Decks not present (or in non-generating
   *  status) simply show the spinner badge without a bar. */
  progress?: Map<number, QuizProgress>
  onCreate: () => void
  onStart: (deckId: number) => void
  onDelete: (deckId: number) => void
  onRetry: (deckId: number) => void
  /** Abort an in-flight generation. When omitted, generating decks show no
   *  Cancel button (e.g. in tests that don't exercise the cancel path). */
  onCancel?: (deckId: number) => void
}

export function QuizListView({
  decks,
  progress,
  onCreate,
  onStart,
  onDelete,
  onRetry,
  onCancel,
}: Props): JSX.Element {
  const t = useT()
  // Per-deck expansion state — kept here rather than inside the card so the
  // history component remounts (and re-fetches) when the user re-opens.
  const [openHistory, setOpenHistory] = useState<Set<number>>(new Set())
  const toggleHistory = (id: number): void => {
    setOpenHistory((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="quiz-list">
      <header className="quiz-list__header">
        <h2>{t('quiz.list.heading')}</h2>
        <button type="button" className="quiz-btn quiz-btn--primary" onClick={onCreate}>
          <Plus size={16} strokeWidth={2.5} />
          {t('quiz.list.newQuiz')}
        </button>
      </header>
      {decks.length === 0 ? (
        <p className="quiz-list__empty">{t('quiz.list.empty')}</p>
      ) : (
        <ul className="quiz-list__items">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              progress={progress?.get(deck.id)}
              t={t}
              historyOpen={openHistory.has(deck.id)}
              onToggleHistory={() => toggleHistory(deck.id)}
              onStart={() => onStart(deck.id)}
              onDelete={() => onDelete(deck.id)}
              onRetry={() => onRetry(deck.id)}
              {...(onCancel ? { onCancel: () => onCancel(deck.id) } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function DeckCard({
  deck,
  progress,
  t,
  historyOpen,
  onToggleHistory,
  onStart,
  onDelete,
  onRetry,
  onCancel,
}: {
  deck: QuizDeckSummary
  progress?: QuizProgress | undefined
  t: TFn
  historyOpen: boolean
  onToggleHistory: () => void
  onStart: () => void
  onDelete: () => void
  onRetry: () => void
  onCancel?: () => void
}): JSX.Element {
  const tone =
    deck.lastScore != null && deck.questionCount > 0
      ? scoreTone(Math.round((deck.lastScore / deck.questionCount) * 100))
      : null

  return (
    <li className={`quiz-card quiz-card--${deck.status}${tone ? ` quiz-card--tone-${tone}` : ''}`}>
      <div className="quiz-card__head">
        <h3 className="quiz-card__name">{deck.name}</h3>
        <StatusBadge status={deck.status} t={t} />
      </div>
      <div className="quiz-card__meta">
        {/* Count is unknown (0) until generation settles it — no chip until then. */}
        {deck.questionCount > 0 && (
          <span className="quiz-card__meta-chip">
            {t('quiz.list.questions', { count: deck.questionCount })}
          </span>
        )}
        <span className="quiz-card__meta-chip">
          {t(deck.documentIds.length === 1 ? 'quiz.list.fileCount' : 'quiz.list.fileCountPlural', {
            count: deck.documentIds.length,
          })}
        </span>
        <span className="quiz-card__meta-chip">{deck.language.toUpperCase()}</span>
      </div>
      {deck.status === 'generating' && <GenerationProgress progress={progress} t={t} />}
      {deck.lastScore != null && (
        <ScoreStrip
          score={deck.lastScore}
          total={deck.questionCount}
          attempts={deck.attemptCount}
          t={t}
        />
      )}
      {deck.status === 'failed' && deck.error && <p className="quiz-card__error">{deck.error}</p>}
      <div className="quiz-card__actions">
        {deck.attemptCount > 0 && (
          <button
            type="button"
            className="quiz-btn quiz-btn--ghost"
            onClick={onToggleHistory}
            aria-expanded={historyOpen}
            aria-label={historyOpen ? t('quiz.list.hideHistory') : t('quiz.list.showHistory')}
          >
            <History size={14} strokeWidth={2.5} />
            {t('quiz.list.history')}
            {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <div className="quiz-card__actions-spacer" />
        {deck.status === 'ready' && (
          <button type="button" className="quiz-btn quiz-btn--primary" onClick={onStart}>
            <Play size={14} strokeWidth={2.5} />
            {t('quiz.list.start')}
          </button>
        )}
        {deck.status === 'failed' && (
          <button type="button" className="quiz-btn" onClick={onRetry}>
            <RotateCcw size={14} strokeWidth={2.5} />
            {t('common.retry')}
          </button>
        )}
        {deck.status === 'generating' && onCancel && (
          <button type="button" className="quiz-btn" onClick={onCancel}>
            <X size={14} strokeWidth={2.5} />
            {t('common.cancel')}
          </button>
        )}
        <button
          type="button"
          className="quiz-btn quiz-btn--danger"
          onClick={onDelete}
          aria-label={t('quiz.list.deleteDeck')}
          title={t('quiz.list.deleteDeck')}
        >
          <Trash2 size={14} strokeWidth={2.5} />
        </button>
      </div>
      {historyOpen && (
        <div className="quiz-card__history-wrap">
          <QuizDeckHistory deckId={deck.id} questionCount={deck.questionCount} />
        </div>
      )}
    </li>
  )
}

function ScoreStrip({
  score,
  total,
  attempts,
  t,
}: {
  score: number
  total: number
  attempts: number
  t: TFn
}): JSX.Element {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0
  const tone = scoreTone(pct)
  return (
    <div className="quiz-card__score-strip">
      <div className="quiz-card__score-bar">
        <div
          className={`quiz-card__score-bar-fill quiz-card__score-bar-fill--${tone}`}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <span className={`quiz-card__score-num quiz-card__score-num--${tone}`}>
        {score} / {total}
      </span>
      <span className="quiz-card__score-attempts">
        {t(attempts === 1 ? 'quiz.list.attemptCount' : 'quiz.list.attemptCountPlural', {
          count: attempts,
        })}
      </span>
    </div>
  )
}

function StatusBadge({
  status,
  t,
}: {
  status: 'generating' | 'ready' | 'failed'
  t: TFn
}): JSX.Element {
  if (status === 'generating') {
    return (
      <span className="quiz-badge quiz-badge--generating">
        <Loader2 size={12} className="quiz-spin" /> {t('quiz.list.statusGenerating')}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="quiz-badge quiz-badge--failed">
        <AlertTriangle size={12} /> {t('quiz.list.statusFailed')}
      </span>
    )
  }
  return <span className="quiz-badge quiz-badge--ready">{t('quiz.list.statusReady')}</span>
}

/** Re-renders once a second while `active` so the live timer/active-phase
 *  duration tick. Returns the current epoch ms; the interval is torn down (and
 *  never started) when inactive, so an idle card costs no recurring re-render. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function GenerationProgress({
  progress,
  t,
}: {
  progress?: QuizProgress | undefined
  t: TFn
}): JSX.Element {
  const live = progress?.startedAt != null
  const now = useNow(live)
  // No event yet → indeterminate bar + "Starting…". Once events flow we show
  // the step label, a x/y detail and a determinate fill.
  const label = progress ? stepLabel(progress, t) : t('quiz.list.stepStarting')
  const detail = progress ? stepDetail(progress, t) : null
  const pct = progress ? progressPercent(progress) : null
  const elapsed = progress?.startedAt != null ? formatClock(now - progress.startedAt) : null
  const timeline = progress?.timeline ?? []
  return (
    <div className="quiz-card__progress" role="status" aria-live="polite">
      <div className="quiz-card__progress-head">
        <span className="quiz-card__progress-step">
          {label}
          {detail && <span className="quiz-card__progress-detail"> · {detail}</span>}
        </span>
        {elapsed && (
          <span className="quiz-card__progress-timer" aria-hidden="true">
            {elapsed}
          </span>
        )}
      </div>
      <div className="quiz-card__progress-bar">
        <div
          className={`quiz-card__progress-fill${pct == null ? ' quiz-card__progress-fill--indeterminate' : ''}`}
          style={pct == null ? undefined : { width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      {timeline.length > 0 && (
        <ul className="quiz-card__timeline">
          <li className="quiz-card__timeline-header">{t('quiz.list.stepsHeader')}</li>
          {timeline.map((ph, i) => {
            const done = ph.endedAt != null
            const dur = (ph.endedAt ?? now) - ph.startedAt
            return (
              <li
                key={`${ph.phase}-${i}`}
                className={`quiz-card__timeline-row${done ? '' : ' quiz-card__timeline-row--active'}`}
              >
                <span className="quiz-card__timeline-icon" aria-hidden="true">
                  {done ? <Check size={12} strokeWidth={3} /> : '●'}
                </span>
                <span className="quiz-card__timeline-name">
                  {phaseLabel(ph.phase, progress, t)}
                </span>
                <span className="quiz-card__timeline-dur">
                  {formatDuration(dur)}
                  {!done && ' …'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
