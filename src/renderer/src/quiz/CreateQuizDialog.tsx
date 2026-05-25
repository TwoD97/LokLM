import { useMemo, useState } from 'react'
import type { Document } from '@shared/documents'
import type { CreateQuizInput, QuizDeck, QuizQuestionCount } from '@shared/quiz'
import { useT } from '../i18n'

type Props = {
  workspaceId: number
  documents: Document[]
  onCancel: () => void
  onCreated: (deck: QuizDeck) => void
}

const COUNTS: QuizQuestionCount[] = [5, 10, 20]

export function CreateQuizDialog({
  workspaceId,
  documents,
  onCancel,
  onCreated,
}: Props): JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set())
  const [count, setCount] = useState<QuizQuestionCount>(10)
  const [language, setLanguage] = useState<'auto' | 'de' | 'en'>('auto')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readyDocs = useMemo(() => documents.filter((d) => d.status === 'ready'), [documents])

  const canSubmit =
    !submitting && name.trim().length > 0 && selectedDocs.size > 0 && COUNTS.includes(count)

  const toggleDoc = (id: number): void => {
    setSelectedDocs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const input: CreateQuizInput = {
        workspaceId,
        name: name.trim(),
        documentIds: [...selectedDocs],
        questionCount: count,
        language,
      }
      const deck = await window.api.quiz.createDeck(input)
      onCreated(deck)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <section className="quiz-create">
      <header className="quiz-create__header">
        <h2>{t('quiz.create.heading')}</h2>
        <button type="button" className="quiz-btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </header>
      <label className="quiz-field">
        <span className="quiz-field__label">{t('quiz.create.nameLabel')}</span>
        <input
          className="quiz-field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={128}
          placeholder={t('quiz.create.namePlaceholder')}
        />
      </label>

      <div className="quiz-field">
        <span className="quiz-field__label">{t('quiz.create.documentsLabel')}</span>
        {readyDocs.length === 0 ? (
          <p className="quiz-create__empty">{t('quiz.create.noDocuments')}</p>
        ) : (
          <ul className="quiz-create__docs">
            {readyDocs.map((doc) => (
              <li key={doc.id}>
                <label className="quiz-create__doc-row">
                  <input
                    type="checkbox"
                    checked={selectedDocs.has(doc.id)}
                    onChange={() => toggleDoc(doc.id)}
                  />
                  <span className="quiz-create__doc-title">{doc.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="quiz-field">
        <span className="quiz-field__label">{t('quiz.create.questionsLabel')}</span>
        <div className="quiz-segmented">
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className={`quiz-segmented__btn ${count === n ? 'quiz-segmented__btn--active' : ''}`}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="quiz-field">
        <span className="quiz-field__label">{t('quiz.create.languageLabel')}</span>
        <div className="quiz-segmented">
          {(['auto', 'de', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`quiz-segmented__btn ${language === l ? 'quiz-segmented__btn--active' : ''}`}
              onClick={() => setLanguage(l)}
            >
              {l === 'auto'
                ? t('quiz.create.languageAuto')
                : l === 'de'
                  ? t('quiz.create.languageDe')
                  : t('quiz.create.languageEn')}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="quiz-create__error">{error}</p>}

      <div className="quiz-create__footer">
        <button
          type="button"
          className="quiz-btn quiz-btn--primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting ? t('quiz.create.generating') : t('quiz.create.generate')}
        </button>
      </div>
    </section>
  )
}
