import { useEffect, useMemo, useRef, useState } from 'react'
import type { MergeQuizInput, QuizDeck, QuizDeckSummary } from '@shared/quiz'
import { useT } from '../i18n'

type Props = {
  workspaceId: number
  /** Ready decks the user can combine — the parent passes only status==='ready'. */
  decks: QuizDeckSummary[]
  onCancel: () => void
  onMerged: (deck: QuizDeck) => void
}

// Combine two or more finished decks into a single new deck. Questions are
// copied in the main process (optionally shuffled); the sources are untouched.
// Mirrors CreateQuizDialog's shape so the two flows feel the same.
export function MergeQuizDialog({ workspaceId, decks, onCancel, onMerged }: Props): JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [shuffle, setShuffle] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const toggleDeck = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Running total of questions across the picked decks — a concrete preview of
  // how big the merged deck will be (the merge itself is pure copy, so this is
  // exact, not an estimate).
  const totalQuestions = useMemo(
    () => decks.filter((d) => selected.has(d.id)).reduce((sum, d) => sum + d.questionCount, 0),
    [decks, selected],
  )

  const canSubmit = !submitting && name.trim().length > 0 && selected.size >= 2

  const submit = async (): Promise<void> => {
    if (!canSubmit || pending.current) return
    pending.current = true
    setSubmitting(true)
    setError(null)
    try {
      const input: MergeQuizInput = {
        workspaceId,
        name: name.trim(),
        deckIds: [...selected],
        shuffle,
      }
      const deck = await window.api.quiz.mergeDecks(input)
      if (alive.current) onMerged(deck)
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : String(err))
        setSubmitting(false)
      }
    } finally {
      pending.current = false
    }
  }

  return (
    <section className="quiz-create">
      <header className="quiz-create__header">
        <h2>{t('quiz.merge.heading')}</h2>
        <button type="button" className="quiz-btn" onClick={onCancel} disabled={submitting}>
          {t('common.cancel')}
        </button>
      </header>

      <label className="quiz-field">
        <span className="quiz-field__label">{t('quiz.merge.nameLabel')}</span>
        <input
          className="quiz-field__input"
          value={name}
          disabled={submitting}
          onChange={(e) => setName(e.target.value)}
          maxLength={128}
          placeholder={t('quiz.merge.namePlaceholder')}
        />
      </label>

      <div className="quiz-field">
        <span className="quiz-field__label">{t('quiz.merge.decksLabel')}</span>
        {decks.length < 2 ? (
          <p className="quiz-create__empty">{t('quiz.merge.noDecks')}</p>
        ) : (
          <ul className="quiz-create__docs">
            {decks.map((deck) => (
              <li key={deck.id}>
                <label className="quiz-create__doc-row">
                  <input
                    type="checkbox"
                    checked={selected.has(deck.id)}
                    disabled={submitting}
                    onChange={() => toggleDeck(deck.id)}
                  />
                  <span className="quiz-create__doc-title">{deck.name}</span>{' '}
                  <span className="quiz-create__doc-meta">
                    {t('quiz.list.questions', { count: deck.questionCount })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {selected.size >= 2 && (
          <p className="quiz-create__estimate">
            {t('quiz.merge.questionsTotal', { count: totalQuestions })}
          </p>
        )}
      </div>

      <label className="quiz-create__doc-row quiz-merge__shuffle">
        <input
          type="checkbox"
          checked={shuffle}
          disabled={submitting}
          onChange={(e) => setShuffle(e.target.checked)}
        />
        <span className="quiz-create__doc-title">{t('quiz.merge.shuffle')}</span>
      </label>

      {error && (
        <p className="quiz-create__error" role="alert">
          {error}
        </p>
      )}

      <div className="quiz-create__footer">
        <button
          type="button"
          className="quiz-btn quiz-btn--primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting ? t('quiz.merge.merging') : t('quiz.merge.merge')}
        </button>
      </div>
    </section>
  )
}
