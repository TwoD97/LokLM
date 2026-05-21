import type { QuizLanguage } from '../../../shared/quiz'

export interface QuizTheme {
  /** Stable id per (doc, theme) — only used in-memory during generation. */
  id: string
  /** Origin document for the theme. After cross-doc dedup, the surviving theme
   *  keeps the docId of the highest-weight contributor. */
  docId: number
  title: string
  summary: string
  weight: number
  /** Chunk IDs the theme is grounded in. In the whole-doc path these are
   *  carried from the extraction step; in the outline path they're populated
   *  lazily during question generation via RetrievalService. */
  groundingChunkIds: number[]
}

export interface ThemeSlot {
  theme: QuizTheme
  /** Number of questions to attempt for this theme. */
  budget: number
}

export interface AcceptedQuestion {
  ordinal: number
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
  themeTitle: string
  /** Embedding of `stem` — kept around to compare new candidates against. */
  stemEmbedding: Float32Array
}

export interface GenerationContext {
  deckId: number
  language: QuizLanguage
  questionCount: number
}
