// Renderer-visible shapes for the quiz feature. Mirrors src/main/db/schema.ts
// rows but lives in src/shared so the renderer (which can't reach into main)
// can import them via the preload bridge. See
// docs/superpowers/specs/2026-05-21-quiz-feature-design.md.

export type QuizDeckStatus = 'generating' | 'ready' | 'failed'
export type QuizLanguage = 'de' | 'en'

export interface QuizDeck {
  id: number
  workspaceId: number
  name: string
  documentIds: number[]
  questionCount: number
  status: QuizDeckStatus
  error: string | null
  language: QuizLanguage
  createdAt: number
}

export interface QuizQuestion {
  id: number
  deckId: number
  ordinal: number
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
  themeTitle: string
}

export interface QuizDeckWithQuestions {
  deck: QuizDeck
  questions: QuizQuestion[]
}

export interface QuizAttemptAnswer {
  questionId: number
  selectedIndex: number
  correct: boolean
}

export interface QuizAttempt {
  id: number
  deckId: number
  startedAt: number
  finishedAt: number | null
  score: number | null
  answers: QuizAttemptAnswer[]
}

// Summary row used by QuizListView: counts + last attempt come from a single
// JOIN in QuizzesRepo.listDecks rather than N follow-up queries.
export interface QuizDeckSummary extends QuizDeck {
  attemptCount: number
  lastScore: number | null
  lastFinishedAt: number | null
}

/** Renderer payload submitted from QuizRunner — selectedIndex per question. */
export interface QuizAttemptSubmission {
  questionId: number
  selectedIndex: number
}

export interface CreateQuizInput {
  workspaceId: number
  name: string
  /** Exactly one document — quizzes are generated one document at a time.
   *  Kept as an array for storage/back-compat with existing multi-doc decks. */
  documentIds: number[]
  language?: QuizLanguage | 'auto'
}

/** Combine several finished decks into one. Questions are copied (optionally
 *  shuffled) into a fresh ready deck; the sources are left untouched. */
export interface MergeQuizInput {
  workspaceId: number
  name: string
  /** Source deck ids — at least two, all status='ready'. */
  deckIds: number[]
  /** Shuffle the combined question order at merge time (the runner also
   *  reshuffles per attempt). */
  shuffle: boolean
}

/** Pre-generation preview for the create dialog: how many material sections
 *  (units) the selection yields plus the size-scaled target question count.
 *  The model's final count can differ, so `questionEstimate` is an upper-ish
 *  guide, not a promise. */
export interface QuizEstimate {
  unitCount: number
  questionEstimate: number
}

export type QuizGenerationEvent =
  | { type: 'plan'; unitCount: number }
  | { type: 'unit'; unitIndex: number; unitTotal: number; unitTitle: string }
  | {
      type: 'question'
      /** Questions accepted so far. No total — the model decides per unit. */
      ordinal: number
      unitTitle?: string
      unitIndex?: number
      unitTotal?: number
    }
  | { type: 'warning'; message: string }
  | { type: 'done'; deckId: number }
  | { type: 'error'; message: string }
