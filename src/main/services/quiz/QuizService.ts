// Quiz orchestrator. Streams events as an AsyncIterable, composed from
// Database + ProviderRegistry. Single-stage chunk-driven pipeline: units are
// built in code from stored chunks, each unit gets exactly one LLM call, and
// quality is enforced by code validation — no themes, no embeddings, no
// retries. See docs/superpowers/specs/2026-06-11-quiz-chunk-generation-design.md.

import type { WorkspaceDbFacade } from '../storage/WorkspaceDbFacade'
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
import { targetQuestionCount } from './prompts'
import { planQuiz, type QuizUnitDoc } from './units'

export class QuizService {
  private readonly generations = new Set<string>()

  constructor(
    private readonly db: WorkspaceDbFacade,
    private readonly registry: ProviderRegistry,
  ) {}

  /** Resolve a user-chosen language. 'auto' inspects the first selected
   *  document's title + first chunk; otherwise pass through. */
  async resolveLanguage(
    workspaceId: number,
    documentIds: number[],
    requested: QuizLanguage | 'auto' | undefined,
    abortSignal?: AbortSignal,
  ): Promise<QuizLanguage> {
    checkCancelled(abortSignal)
    if (requested === 'de' || requested === 'en') return requested
    const repo = await this.db.documentsFor(workspaceId)
    checkCancelled(abortSignal)
    for (const id of documentIds) {
      const doc = await repo.getDocument(id)
      checkCancelled(abortSignal)
      if (!doc) continue
      const chunks = await repo.listChunksForDocument(id)
      checkCancelled(abortSignal)
      const sample = (doc.title + ' ' + (chunks[0]?.text ?? '')).slice(0, 600)
      if (looksGerman(sample)) return 'de'
      if (looksEnglish(sample)) return 'en'
    }
    return 'en'
  }

  /** Load (docId, title, non-empty chunks) for each existing document. */
  private async loadUnitDocs(
    workspaceId: number,
    documentIds: number[],
    abortSignal?: AbortSignal,
  ): Promise<{ unitDocs: QuizUnitDoc[]; warnings: string[] }> {
    checkCancelled(abortSignal)
    const documents = await this.db.documentsFor(workspaceId)
    checkCancelled(abortSignal)
    const unitDocs: QuizUnitDoc[] = []
    const warnings: string[] = []
    for (const docId of documentIds) {
      const doc = await documents.getDocument(docId)
      checkCancelled(abortSignal)
      if (!doc) {
        warnings.push(`Document ${docId} not found, skipping.`)
        continue
      }
      const chunks = await documents.listChunksForDocument(docId)
      checkCancelled(abortSignal)
      const ready = chunks.filter((c) => (c.text ?? '').trim().length > 0)
      if (ready.length === 0) {
        warnings.push(`"${doc.title}" has no indexable content.`)
        continue
      }
      unitDocs.push({ docId, docTitle: doc.title, chunks: ready })
    }
    return { unitDocs, warnings }
  }

  /** Create-dialog preview: how many material sections the selection yields and
   *  the size-scaled target question count. Pure chunk-stat math — runs in
   *  milliseconds, no LLM. The model's final count can differ, so
   *  questionEstimate is a guide, not a promise. */
  async estimate(documentIds: number[], abortSignal?: AbortSignal): Promise<QuizEstimate> {
    const workspaceId = this.db.quizzes().workspaceId
    const { unitDocs } = await this.loadUnitDocs(workspaceId, documentIds, abortSignal)
    const { units } = planQuiz(unitDocs)
    const questionEstimate = units.reduce(
      (sum, u) => sum + targetQuestionCount(u.tokens, u.docTokens),
      0,
    )
    return { unitCount: units.length, questionEstimate }
  }

  /** Create the deck row up-front with status='generating' so the renderer
   *  has something to render while the pipeline runs. question_count starts
   *  at 0 (unknown — the model decides per unit) and settles to the persisted
   *  row count when generation finishes. */
  async createDeckRow(input: CreateQuizInput, abortSignal?: AbortSignal): Promise<QuizDeck> {
    validateCreateInput(input)
    checkCancelled(abortSignal)
    const quizzes = await this.db.quizzesFor(input.workspaceId)
    checkCancelled(abortSignal)
    const language = await this.resolveLanguage(
      input.workspaceId,
      input.documentIds,
      input.language,
      abortSignal,
    )
    checkCancelled(abortSignal)
    return quizzes.createDeck({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      documentIds: input.documentIds,
      questionCount: 0,
      language,
    })
  }

  /** Never clear a deck underneath its running generator. The storage reset
   *  itself is atomic and uses the workspace captured before any await. */
  async prepareRegeneration(deckId: number): Promise<void> {
    const quizzes = this.db.quizzes()
    if (this.generations.has(`${quizzes.workspaceId}:${deckId}`)) {
      throw new Error('Quiz generation is already running')
    }
    await quizzes.resetDeckForGeneration(deckId)
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
    const deck = await quizzes.getDeck(deckId)
    if (!deck) {
      yield { type: 'error', message: `Deck ${deckId} not found` }
      return
    }
    const key = `${quizzes.workspaceId}:${deckId}`
    if (this.generations.has(key)) {
      yield { type: 'error', message: 'Quiz generation is already running' }
      return
    }
    if (deck.status !== 'generating') {
      yield { type: 'error', message: 'Quiz is not awaiting generation' }
      return
    }
    this.generations.add(key)
    let settled = false

    try {
      checkCancelled(abortSignal)
      const llm = this.registry.llm()
      const { unitDocs, warnings } = await this.loadUnitDocs(
        deck.workspaceId,
        deck.documentIds,
        abortSignal,
      )
      for (const message of warnings) {
        checkCancelled(abortSignal)
        yield { type: 'warning', message }
      }
      checkCancelled(abortSignal)

      // Plan in code: section-aware units covering ALL the material. How many
      // questions each unit yields is the model's decision during generation.
      const { units } = planQuiz(unitDocs)
      if (units.length === 0) {
        throw new Error('no indexable content in selected documents')
      }
      yield { type: 'plan', unitCount: units.length }

      // One grammar-constrained call per unit. Small prompts by construction
      // (units are token-bounded), with no speculative background model calls.
      const accepted: AcceptedQuestion[] = []
      for (let i = 0; i < units.length; i += 1) {
        const unit = units[i]!
        checkCancelled(abortSignal)
        yield { type: 'unit', unitIndex: i + 1, unitTotal: units.length, unitTitle: unit.title }
        checkCancelled(abortSignal)
        const batch = await generateQuestionsForUnit(llm, {
          language: deck.language,
          unit,
          acceptedStems: accepted.map((a) => a.stem),
          ...(abortSignal ? { abortSignal } : {}),
        })
        checkCancelled(abortSignal)
        for (const q of batch) {
          checkCancelled(abortSignal)
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
        throw new Error('no questions accepted by validation')
      }

      checkCancelled(abortSignal)
      await quizzes.completeGeneration(
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
      // Publishing is one synchronous SQLite transaction. Once committed, a
      // cancellation cannot turn the complete, usable deck into a failed one.
      settled = true
      if (abortSignal?.aborted) return
      yield { type: 'done', deckId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const errorText = abortSignal?.aborted ? 'cancelled' : message
      try {
        await quizzes.setDeckStatus(deckId, 'failed', errorText)
      } catch {
        /* DB might be gone — swallow */
      }
      settled = true
      yield { type: 'error', message: errorText }
    } finally {
      try {
        // for-await break/return does not enter catch. Do not leave a deck
        // permanently "generating" when its consumer stops reading events.
        if (!settled) await quizzes.setDeckStatus(deckId, 'failed', 'cancelled')
      } catch {
        /* The originating workspace may have been locked or deleted. */
      } finally {
        this.generations.delete(key)
      }
    }
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('cancelled')
}

export function validateCreateInput(input: CreateQuizInput): void {
  const name = (input.name ?? '').trim()
  if (name.length < 1 || name.length > 128) {
    throw new Error('Quiz name must be 1–128 characters')
  }
  // Quizzes are generated one document at a time (multi-document decks now come
  // only from merging finished decks). Existing multi-doc decks still work.
  if (!Array.isArray(input.documentIds) || input.documentIds.length !== 1) {
    throw new Error('Select exactly one document')
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
