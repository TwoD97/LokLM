import { useState } from 'react'
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
} from 'lucide-react'
import type { QuizDeckSummary } from '@shared/quiz'
import { QuizDeckHistory, scoreTone } from './QuizDeckHistory'
import { useT, type TFn } from '../i18n'

/** Live generation progress for one deck, derived in QuizView from the
 *  QuizGenerationEvent stream. Undefined until the first event arrives. */
export interface QuizProgress {
  stage: 'extracting-themes' | 'merging-themes' | 'allocating' | 'generating-questions'
  /** extracting-themes: which document is being read. */
  docIndex?: number
  docTotal?: number
  /** generating-questions: how many questions accepted so far / target. */
  ordinal?: number
  total?: number
}

/** Coarse weighted percentage across the 4 pipeline phases so the bar advances
 *  monotonically. Reading docs = 0–30 %, merge 38 %, prepare 45 %, writing
 *  questions = 50–100 % (the long phase gets the back half). */
function progressPercent(p: QuizProgress): number {
  switch (p.stage) {
    case 'extracting-themes':
      return p.docTotal ? Math.round(((p.docIndex ?? 0) / p.docTotal) * 30) : 6
    case 'merging-themes':
      return 38
    case 'allocating':
      return 45
    case 'generating-questions':
      return p.total ? 50 + Math.round(((p.ordinal ?? 0) / p.total) * 50) : 50
  }
}

function stepLabel(p: QuizProgress, t: TFn): string {
  switch (p.stage) {
    case 'extracting-themes':
      return t('quiz.list.stepExtracting')
    case 'merging-themes':
      return t('quiz.list.stepMerging')
    case 'allocating':
      return t('quiz.list.stepAllocating')
    case 'generating-questions':
      return t('quiz.list.stepGenerating')
  }
}

function stepDetail(p: QuizProgress, t: TFn): string | null {
  if (p.stage === 'extracting-themes' && p.docTotal && p.docTotal > 1) {
    return t('quiz.list.stepDocProgress', { current: p.docIndex ?? 0, total: p.docTotal })
  }
  if (p.stage === 'generating-questions' && p.total) {
    return t('quiz.list.stepQuestionProgress', { current: p.ordinal ?? 0, total: p.total })
  }
  return null
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
        <span className="quiz-card__meta-chip">
          {t('quiz.list.questions', { count: deck.questionCount })}
        </span>
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

function GenerationProgress({
  progress,
  t,
}: {
  progress?: QuizProgress | undefined
  t: TFn
}): JSX.Element {
  // No event yet → indeterminate bar + "Starting…". Once events flow we show
  // the step label, a x/y detail and a determinate fill.
  const label = progress ? stepLabel(progress, t) : t('quiz.list.stepStarting')
  const detail = progress ? stepDetail(progress, t) : null
  const pct = progress ? progressPercent(progress) : null
  return (
    <div className="quiz-card__progress" role="status" aria-live="polite">
      <div className="quiz-card__progress-head">
        <span className="quiz-card__progress-step">{label}</span>
        {detail && <span className="quiz-card__progress-detail">{detail}</span>}
      </div>
      <div className="quiz-card__progress-bar">
        <div
          className={`quiz-card__progress-fill${pct == null ? ' quiz-card__progress-fill--indeterminate' : ''}`}
          style={pct == null ? undefined : { width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
