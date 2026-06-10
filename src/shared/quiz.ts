// Renderer-visible shapes for the quiz feature. Mirrors src/main/db/schema.ts
// rows but lives in src/shared so the renderer (which can't reach into main)
// can import them via the preload bridge. See
// docs/superpowers/specs/2026-05-21-quiz-feature-design.md.

export type QuizDeckStatus = 'generating' | 'ready' | 'failed'
export type QuizLanguage = 'de' | 'en'
export type QuizQuestionCount = 5 | 10 | 20

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
  documentIds: number[]
  questionCount: QuizQuestionCount
  language?: QuizLanguage | 'auto'
}

export type QuizGenerationEvent =
  | { type: 'stage'; stage: 'extracting-themes' | 'merging-themes' | 'allocating' }
  | { type: 'doc-themes'; docId: number; docIndex: number; docTotal: number; themeCount: number }
  | { type: 'theme'; themeIndex: number; themeTotal: number; themeTitle: string }
  | {
      type: 'question'
      ordinal: number
      total: number
      themeTitle?: string
      themeIndex?: number
      themeTotal?: number
    }
  | { type: 'warning'; message: string }
  | { type: 'done'; deckId: number }
  | { type: 'error'; message: string }
