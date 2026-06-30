import { useEffect, useMemo, useState } from 'react'
import type { Document } from '@shared/documents'
import type { CreateQuizInput, QuizDeck, QuizEstimate } from '@shared/quiz'
import { useT } from '../i18n'

type Props = {
  workspaceId: number
  documents: Document[]
  onCancel: () => void
  onCreated: (deck: QuizDeck) => void
}

// Trailing file extensions worth stripping from an auto-filled quiz name. Kept
// to a known document allowlist (mirrors the importer's accepted types, plus a
// few common variants) so titles like "Biology Ch.3" or "v1.2" aren't mangled
// by treating their suffix as an extension.
const STRIPPABLE_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'doc',
  'md',
  'markdown',
  'txt',
  'text',
  'json',
  'html',
  'htm',
  'rtf',
  'odt',
  'epub',
  'pptx',
  'ppt',
  'csv',
  'xlsx',
  'xls',
])

/** Default quiz name from a document title: the title with a known file
 *  extension removed (`lecture.pdf` → `lecture`), left untouched otherwise. */
export function defaultQuizName(title: string): string {
  const dot = title.lastIndexOf('.')
  if (dot > 0 && STRIPPABLE_EXTENSIONS.has(title.slice(dot + 1).toLowerCase())) {
    return title.slice(0, dot)
  }
  return title
}

export function CreateQuizDialog({
  workspaceId,
  documents,
  onCancel,
  onCreated,
}: Props): JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  // Once the user types in the name field it's theirs — auto-fill stops
  // overwriting it (stays true even if they clear it, so an empty name is a
  // deliberate choice, not a cue to refill).
  const [nameEdited, setNameEdited] = useState(false)
  // One document at a time — quizzes generate from a single document now.
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [language, setLanguage] = useState<'auto' | 'de' | 'en'>('auto')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // No question-count picker: the model decides how many questions each
  // section needs during generation. The preview shows the section count plus
  // an estimated question total, computed from chunk stats in the main process
  // at zero model cost.
  const [estimate, setEstimate] = useState<QuizEstimate | null>(null)

  useEffect(() => {
    if (selectedDocId === null) {
      setEstimate(null)
      return
    }
    let stale = false
    // Small debounce so rapid selection changes don't queue a burst of IPC.
    const handle = setTimeout(() => {
      window.api.quiz
        .estimate([selectedDocId])
        .then((est) => {
          if (!stale) setEstimate(est)
        })
        .catch(() => {
          if (!stale) setEstimate(null)
        })
    }, 150)
    return () => {
      stale = true
      clearTimeout(handle)
    }
  }, [selectedDocId])

  const readyDocs = useMemo(() => documents.filter((d) => d.status === 'ready'), [documents])

  // Default the quiz name to the selected document's title — a sensible starting
  // point the user can override. Skips once the user has typed their own name,
  // and follows the selection while the name is still untouched.
  useEffect(() => {
    if (nameEdited || selectedDocId === null) return
    const doc = readyDocs.find((d) => d.id === selectedDocId)
    if (doc) setName(defaultQuizName(doc.title))
  }, [selectedDocId, nameEdited, readyDocs])

  const canSubmit = !submitting && name.trim().length > 0 && selectedDocId !== null

  const submit = async (): Promise<void> => {
    if (!canSubmit || selectedDocId === null) return
    setSubmitting(true)
    setError(null)
    try {
      const input: CreateQuizInput = {
        workspaceId,
        name: name.trim(),
        documentIds: [selectedDocId],
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
          onChange={(e) => {
            setName(e.target.value)
            setNameEdited(true)
          }}
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
                    type="radio"
                    name="quiz-document"
                    checked={selectedDocId === doc.id}
                    onChange={() => setSelectedDocId(doc.id)}
                  />
                  <span className="quiz-create__doc-title">{doc.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {estimate !== null &&
          (estimate.unitCount > 0 ? (
            <p className="quiz-create__estimate">
              {t('quiz.create.estimate', {
                sections: estimate.unitCount,
                questions: estimate.questionEstimate,
              })}
            </p>
          ) : (
            <p className="quiz-create__estimate quiz-create__estimate--empty">
              {t('quiz.create.estimateEmpty')}
            </p>
          ))}
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
