// Quiz orchestrator. Mirrors QAService in shape: streams events as an
// AsyncIterable, composed from Database + RetrievalService + ProviderRegistry.
// See docs/superpowers/specs/2026-05-21-quiz-feature-design.md.

import type { Database, ChunkRow } from '../../db/database'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { ProviderRegistry } from '../providers/Registry'
import type {
  CreateQuizInput,
  QuizDeck,
  QuizGenerationEvent,
  QuizLanguage,
} from '../../../shared/quiz'
import type { AcceptedQuestion, QuizTheme } from './types'
import { allocateSlots, dedupThemes, extractThemesForDocument } from './themes'
import { generateQuestionsForTheme } from './generation'

const TARGET_THEMES_FACTOR = 1.5
/** Fewer themes on CPU — each theme is an LLM round-trip, so we trade breadth
 *  for finishing. */
const TARGET_THEMES_FACTOR_CPU = 1.0
/** Grounding chunks per theme: fewer on CPU to keep prompts cheap. */
const GROUNDING_TOPK = 6
const GROUNDING_TOPK_CPU = 2
/** Outline-path retrieval breadth (themes without window grounding ids). */
const OUTLINE_TOPK = 5
const OUTLINE_TOPK_CPU = 2

export class QuizService {
  constructor(
    private readonly db: Database,
    private readonly retrieval: RetrievalService,
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

  /** Create the deck row up-front with status='generating' so the renderer
   *  has something to render while the pipeline runs. Validation matches the
   *  spec's IPC-boundary rules. */
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
      questionCount: input.questionCount,
      language,
    })
  }

  /** Run the 5-stage pipeline for an existing deck row. Yields
   *  QuizGenerationEvent so the IPC layer can forward to the renderer.
   *  On success the deck row flips to status='ready' and questions are
   *  persisted. On any unrecoverable failure status flips to 'failed' with
   *  a populated `error` column. Cancellation flips to 'failed' with
   *  error='cancelled'. */
  async *generate(deckId: number, abortSignal?: AbortSignal): AsyncIterable<QuizGenerationEvent> {
    const quizzes = this.db.quizzes()
    const documents = this.db.documents()
    const llm = this.registry.llm()
    const embedder = this.registry.embedder()
    // CPU inference is far slower — apply hard work-caps so a run finishes
    // (trading completeness) rather than stalling and flipping to Failed.
    const cpu = llm.isCpuInference?.() ?? false

    const deck = await quizzes.getDeck(deckId)
    if (!deck) {
      yield { type: 'error', message: `Deck ${deckId} not found` }
      return
    }

    try {
      // ---- Stage 1: per-doc theme extraction ----
      yield { type: 'stage', stage: 'extracting-themes' }
      const docIds = deck.documentIds
      const themes: QuizTheme[] = []
      const themesFactor = cpu ? TARGET_THEMES_FACTOR_CPU : TARGET_THEMES_FACTOR
      const targetPerDoc = Math.max(
        2,
        Math.ceil((deck.questionCount * themesFactor) / Math.max(1, docIds.length)),
      )
      let emptyDocCount = 0
      for (let i = 0; i < docIds.length; i += 1) {
        if (abortSignal?.aborted) throw new Error('cancelled')
        const docId = docIds[i]!
        const doc = await documents.getDocument(docId)
        if (!doc) {
          emptyDocCount += 1
          yield { type: 'warning', message: `Document ${docId} not found, skipping.` }
          continue
        }
        const chunks = await documents.listChunksForDocument(docId)
        const readyChunks = chunks.filter((c) => (c.text ?? '').trim().length > 0)
        if (readyChunks.length === 0) {
          emptyDocCount += 1
          yield { type: 'warning', message: `"${doc.title}" has no indexable content.` }
          continue
        }
        const docThemes = await extractThemesForDocument(
          { llm, documents },
          {
            docId,
            docTitle: doc.title,
            chunks: readyChunks,
            language: deck.language,
            targetCount: targetPerDoc,
            cpu,
            ...(abortSignal ? { abortSignal } : {}),
          },
        )
        themes.push(...docThemes)
        yield {
          type: 'doc-themes',
          docId,
          docIndex: i + 1,
          docTotal: docIds.length,
          themeCount: docThemes.length,
        }
      }

      if (themes.length === 0) {
        const msg =
          emptyDocCount === docIds.length
            ? 'no indexable content in selected documents'
            : 'no themes extracted from selected documents'
        await quizzes.setDeckStatus(deckId, 'failed', msg)
        yield { type: 'error', message: msg }
        return
      }

      // ---- Stage 2: cross-document dedup ----
      if (abortSignal?.aborted) throw new Error('cancelled')
      yield { type: 'stage', stage: 'merging-themes' }
      const merged = await dedupThemes(embedder, themes)

      // ---- Stage 3: allocate slots ----
      yield { type: 'stage', stage: 'allocating' }
      const slots = allocateSlots(merged, deck.questionCount)
      if (slots.length === 0) {
        await quizzes.setDeckStatus(deckId, 'failed', 'no slots after allocation')
        yield { type: 'error', message: 'no slots after allocation' }
        return
      }

      // ---- Stage 4: batch-per-theme generation ----
      const accepted: AcceptedQuestion[] = []
      // Pre-fetch grounding chunks per theme up front so the inner loop is
      // purely LLM-bound. Themes carry chunk ids from windowed extraction; a
      // theme without ids (shouldn't happen post-rework) falls back to a
      // RetrievalService hit.
      const groundingByTheme = new Map<string, ChunkRow[]>()
      for (const slot of slots) {
        if (abortSignal?.aborted) throw new Error('cancelled')
        const chunks = await this.resolveGrounding(deck.workspaceId, slot.theme, cpu)
        groundingByTheme.set(slot.theme.id, chunks)
      }

      // Theme context attached to each `question` event so the UI can show
      // which theme produced it. Set before each batch call below.
      let themeContext: { themeTitle: string; themeIndex: number; themeTotal: number } | null = null
      const themeTotal = slots.length
      const emitAccepted = (
        questions: Array<Omit<AcceptedQuestion, 'ordinal'>>,
      ): QuizGenerationEvent[] => {
        const events: QuizGenerationEvent[] = []
        for (const q of questions) {
          if (accepted.length >= deck.questionCount) break
          accepted.push({ ...q, ordinal: accepted.length })
          events.push({
            type: 'question',
            ordinal: accepted.length,
            total: deck.questionCount,
            ...(themeContext ?? {}),
          })
        }
        return events
      }

      // One grammar-constrained batch call per allocated theme.
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i]!
        if (abortSignal?.aborted) throw new Error('cancelled')
        if (accepted.length >= deck.questionCount) break
        const grounding = groundingByTheme.get(slot.theme.id) ?? []
        if (grounding.length === 0) continue
        // Announce the theme before the (long) batch call so the UI shows the
        // current theme even before any question of it completes.
        themeContext = { themeTitle: slot.theme.title, themeIndex: i + 1, themeTotal }
        yield { type: 'theme', themeIndex: i + 1, themeTotal, themeTitle: slot.theme.title }
        const need = Math.min(slot.budget, deck.questionCount - accepted.length)
        const batch = await generateQuestionsForTheme(llm, embedder, {
          language: deck.language,
          theme: slot.theme,
          groundingChunks: grounding,
          accepted,
          count: need,
          cpu,
          ...(abortSignal ? { abortSignal } : {}),
        })
        for (const ev of emitAccepted(batch)) yield ev
      }

      // Top-up: if we're short, re-call the heaviest themes that have grounding
      // for the remaining count. Bounded by maxTopUps so a model that keeps
      // producing dups/invalid output can't spin forever.
      const heaviestFirst = [...slots]
        .filter((s) => (groundingByTheme.get(s.theme.id) ?? []).length > 0)
        .sort((a, b) => b.theme.weight - a.theme.weight)
      let topUpAttempts = 0
      // Skip top-up on CPU: each retry is another minutes-long LLM call. We'd
      // rather hand the user a short deck quickly than make them wait another
      // ~5 min per missing question. The 'short deck' warning still fires below.
      const maxTopUps = cpu ? 0 : deck.questionCount
      while (accepted.length < deck.questionCount && heaviestFirst.length > 0) {
        if (abortSignal?.aborted) throw new Error('cancelled')
        if (topUpAttempts >= maxTopUps) break
        const slot = heaviestFirst[topUpAttempts % heaviestFirst.length]!
        topUpAttempts += 1
        const slotIndex = slots.indexOf(slot)
        themeContext = {
          themeTitle: slot.theme.title,
          themeIndex: slotIndex >= 0 ? slotIndex + 1 : 1,
          themeTotal,
        }
        const grounding = groundingByTheme.get(slot.theme.id) ?? []
        const need = deck.questionCount - accepted.length
        const batch = await generateQuestionsForTheme(llm, embedder, {
          language: deck.language,
          theme: slot.theme,
          groundingChunks: grounding,
          accepted,
          count: need,
          cpu,
          ...(abortSignal ? { abortSignal } : {}),
        })
        if (batch.length === 0) continue
        for (const ev of emitAccepted(batch)) yield ev
      }

      if (accepted.length === 0) {
        await quizzes.setDeckStatus(deckId, 'failed', 'no questions accepted by validation')
        yield { type: 'error', message: 'no questions accepted by validation' }
        return
      }
      if (accepted.length < deck.questionCount) {
        yield {
          type: 'warning',
          message: `${accepted.length} of ${deck.questionCount} questions generated`,
        }
      }

      // ---- Stage 5: persist + finalize ----
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

  /** Resolve grounding chunks for a theme. Whole-doc themes carry IDs from
   *  Stage 1 → load by id. Outline themes have empty groundingChunkIds → use
   *  the retrieval index keyed on the theme title, scoped to the theme's doc. */
  private async resolveGrounding(
    workspaceId: number,
    theme: QuizTheme,
    cpu = false,
  ): Promise<ChunkRow[]> {
    const documents = this.db.documents()
    if (theme.groundingChunkIds.length > 0) {
      const allChunks = await documents.listChunksForDocument(theme.docId)
      const allowed = new Set(theme.groundingChunkIds)
      // Whole-doc themes have ALL chunks attached. Top-K trim so the prompt
      // doesn't blow the context window. We pick the longest chunks because
      // they tend to be most useful for question writing.
      const filtered = allChunks.filter((c) => allowed.has(c.id))
      return filtered
        .slice()
        .sort((a, b) => (b.token_count ?? 0) - (a.token_count ?? 0))
        .slice(0, cpu ? GROUNDING_TOPK_CPU : GROUNDING_TOPK)
        .sort((a, b) => a.ordinal - b.ordinal)
    }
    // Outline path: retrieve top-K relevant chunks for the theme title,
    // scoped to this theme's source document.
    const hits = await this.retrieval.search(
      workspaceId,
      `${theme.title} — ${theme.summary}`,
      cpu ? OUTLINE_TOPK_CPU : OUTLINE_TOPK,
      { activeDocumentIds: [theme.docId] },
    )
    const allChunks = await documents.listChunksForDocument(theme.docId)
    const byId = new Map(allChunks.map((c) => [c.id, c]))
    const out: ChunkRow[] = []
    for (const h of hits) {
      const c = byId.get(h.chunk_id)
      if (c) out.push(c)
    }
    return out
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
  if (![5, 10, 20].includes(input.questionCount)) {
    throw new Error('questionCount must be 5, 10 or 20')
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
