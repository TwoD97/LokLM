// Quiz orchestrator. Streams events as an AsyncIterable, composed from
// Database + ProviderRegistry. Single-stage chunk-driven pipeline: units are
// built in code from stored chunks, each unit gets exactly one LLM call, and
// quality is enforced by code validation — no themes, no embeddings, no
// retries. See docs/superpowers/specs/2026-06-11-quiz-chunk-generation-design.md.

import type { Database } from '../../db/database'
import type { ProviderRegistry } from '../providers/Registry'
import type {
  CreateQuizInput,
  QuizDeck,
  QuizEstimate,
  QuizGenerationEvent,
  QuizLanguage,
} from '../../../shared/quiz'
import type { AcceptedQuestion } from './types'
import { generateQuestionsForUnit } from './generation'
import { planQuiz, type QuizUnitDoc } from './units'

export class QuizService {
  constructor(
    private readonly db: Database,
    private readonly registry: ProviderRegistry,
  ) {}

  /** Resolve a user-chosen language. 'auto' inspects the first selected
   *  document's title + first chunk; otherwise pass through. */
  async resolveLanguage(
    workspaceId: number,
    documentIds: number[],
    requested: QuizLanguage | 'auto' | undefined,
  ): Promise<QuizLanguage> {
    if (requested === 'de' || requested === 'en') return requested
    void workspaceId
    const repo = this.db.documents()
    for (const id of documentIds) {
      const doc = await repo.getDocument(id)
      if (!doc) continue
      const chunks = await repo.listChunksForDocument(id)
      const sample = (doc.title + ' ' + (chunks[0]?.text ?? '')).slice(0, 600)
      if (looksGerman(sample)) return 'de'
      if (looksEnglish(sample)) return 'en'
    }
    return 'en'
  }

  /** Load (docId, title, non-empty chunks) for each existing document. */
  private async loadUnitDocs(
    documentIds: number[],
  ): Promise<{ unitDocs: QuizUnitDoc[]; warnings: string[] }> {
    const documents = this.db.documents()
    const unitDocs: QuizUnitDoc[] = []
    const warnings: string[] = []
    for (const docId of documentIds) {
      const doc = await documents.getDocument(docId)
      if (!doc) {
        warnings.push(`Document ${docId} not found, skipping.`)
        continue
      }
      const chunks = await documents.listChunksForDocument(docId)
      const ready = chunks.filter((c) => (c.text ?? '').trim().length > 0)
      if (ready.length === 0) {
        warnings.push(`"${doc.title}" has no indexable content.`)
        continue
      }
      unitDocs.push({ docId, docTitle: doc.title, chunks: ready })
    }
    return { unitDocs, warnings }
  }

  /** Create-dialog preview: how many material sections the selection yields.
   *  Pure chunk-stat math — runs in milliseconds, no LLM. The question count
   *  is the model's per-section decision, unknowable before generation. */
  async estimate(documentIds: number[]): Promise<QuizEstimate> {
    const { unitDocs } = await this.loadUnitDocs(documentIds)
    return { unitCount: planQuiz(unitDocs).units.length }
  }

  /** Create the deck row up-front with status='generating' so the renderer
   *  has something to render while the pipeline runs. question_count starts
   *  at 0 (unknown — the model decides per unit) and settles to the persisted
   *  row count when generation finishes. */
  async createDeckRow(input: CreateQuizInput): Promise<QuizDeck> {
    validateCreateInput(input)
    const language = await this.resolveLanguage(
      input.workspaceId,
      input.documentIds,
      input.language,
    )
    return this.db.quizzes().createDeck({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      documentIds: input.documentIds,
      questionCount: 0,
      language,
    })
  }

  /** Run the chunk-driven pipeline for an existing deck row. Yields
   *  QuizGenerationEvent so the IPC layer can forward to the renderer.
   *  On success the deck row flips to status='ready' and questions are
   *  persisted. On any unrecoverable failure status flips to 'failed' with
   *  a populated `error` column. Cancellation flips to 'failed' with
   *  error='cancelled'. Deck size is whatever the model produced across all
   *  units — there is no target and deliberately no retry. */
  async *generate(deckId: number, abortSignal?: AbortSignal): AsyncIterable<QuizGenerationEvent> {
    const quizzes = this.db.quizzes()
    const llm = this.registry.llm()

    const deck = await quizzes.getDeck(deckId)
    if (!deck) {
      yield { type: 'error', message: `Deck ${deckId} not found` }
      return
    }

    try {
      const { unitDocs, warnings } = await this.loadUnitDocs(deck.documentIds)
      for (const message of warnings) yield { type: 'warning', message }
      if (abortSignal?.aborted) throw new Error('cancelled')

      // Plan in code: section-aware units covering ALL the material. How many
      // questions each unit yields is the model's decision during generation.
      const { units } = planQuiz(unitDocs)
      if (units.length === 0) {
        const msg = 'no indexable content in selected documents'
        await quizzes.setDeckStatus(deckId, 'failed', msg)
        yield { type: 'error', message: msg }
        return
      }
      yield { type: 'plan', unitCount: units.length }

      // One grammar-constrained call per unit. Small prompts by construction
      // (units are token-bounded), so the same code path serves GPU and CPU.
      const accepted: AcceptedQuestion[] = []
      for (let i = 0; i < units.length; i += 1) {
        const unit = units[i]!
        if (abortSignal?.aborted) throw new Error('cancelled')
        yield { type: 'unit', unitIndex: i + 1, unitTotal: units.length, unitTitle: unit.title }
        const batch = await generateQuestionsForUnit(llm, {
          language: deck.language,
          unit,
          acceptedStems: accepted.map((a) => a.stem),
          ...(abortSignal ? { abortSignal } : {}),
        })
        for (const q of batch) {
          accepted.push({ ...q, ordinal: accepted.length })
          yield {
            type: 'question',
            ordinal: accepted.length,
            unitTitle: unit.title,
            unitIndex: i + 1,
            unitTotal: units.length,
          }
        }
      }

      if (accepted.length === 0) {
        await quizzes.setDeckStatus(deckId, 'failed', 'no questions accepted by validation')
        yield { type: 'error', message: 'no questions accepted by validation' }
        return
      }

      await quizzes.insertQuestions(
        deckId,
        accepted.map((a, i) => ({
          ordinal: i,
          stem: a.stem,
          options: a.options,
          correctIndex: a.correctIndex,
          explanation: a.explanation,
          sourceChunkIds: a.sourceChunkIds,
          themeTitle: a.themeTitle,
        })),
      )
      // The deck's question_count must match the persisted rows — score
      // displays divide by it.
      await quizzes.updateDeckQuestionCount(deckId, accepted.length)
      await quizzes.setDeckStatus(deckId, 'ready', null)
      yield { type: 'done', deckId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const errorText = message === 'cancelled' ? 'cancelled' : message
      try {
        await quizzes.setDeckStatus(deckId, 'failed', errorText)
      } catch {
        /* DB might be gone — swallow */
      }
      yield { type: 'error', message: errorText }
    }
  }
}

export function validateCreateInput(input: CreateQuizInput): void {
  const name = (input.name ?? '').trim()
  if (name.length < 1 || name.length > 128) {
    throw new Error('Quiz name must be 1–128 characters')
  }
  if (!Array.isArray(input.documentIds) || input.documentIds.length === 0) {
    throw new Error('Select at least one document')
  }
  if (typeof input.workspaceId !== 'number' || !Number.isInteger(input.workspaceId)) {
    throw new Error('workspaceId is required')
  }
}

// Same heuristics as QAService.detectLanguage but exported separately so the
// resolveLanguage caller doesn't depend on QAService internals.
function looksGerman(text: string): boolean {
  if (/[äöüÄÖÜß]/.test(text)) return true
  return /\b(der|die|das|und|ist|nicht|auch|sich|mit|dem|den|von|zu|für)\b/i.test(text)
}

function looksEnglish(text: string): boolean {
  return /\b(the|and|of|to|in|is|that|for|with|on|as|by)\b/i.test(text)
}
