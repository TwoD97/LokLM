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
import { dedupThemes, extractThemesForDocument } from './themes'
import { generateQuestionBatch, isStemDuplicate } from './generation'

const TARGET_THEMES_FACTOR = 1.5
/** Questions requested per LLM call. Batching amortises the prompt prefill —
 *  the dominant per-call cost on a compute-bound model — across this many
 *  questions, roughly halving the number of round-trips at 2. */
const QUIZ_BATCH_SIZE = 2

/** Per-stage timing breadcrumbs for tuning generation speed. Off by default;
 *  set LOKLM_QUIZ_DEBUG=1 to see `[quiz] …` lines while optimizing. */
function quizDebug(message: string): void {
  if (process.env['LOKLM_QUIZ_DEBUG']) {
    // eslint-disable-next-line no-console
    console.log(message)
  }
}
/** Upper bound on parallel decode slots requested from the bundled pool. Each
 *  slot holds a full QUIZ_POOL_CONTEXT_TOKENS KV cache. At 8192 tokens, 6 slots
 *  over-pressured VRAM on the 9B and made parallel decode 5–8× slower than solo;
 *  at 4096 tokens the per-slot KV is a quarter the size, so 6 slots fit (≈ the
 *  old 3×8192 footprint) and we get fewer, fuller waves. The worker still clamps
 *  to GPU headroom (and to 1 on CPU). */
const QUIZ_MAX_SLOTS = 6
/** Per-sequence context window. A grounded MCQ prompt is ~1.9k tokens + a
 *  768-token answer; 4096 fits it with margin at a quarter of the prior KV. */
const QUIZ_POOL_CONTEXT_TOKENS = 4096

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

    const deck = await quizzes.getDeck(deckId)
    if (!deck) {
      yield { type: 'error', message: `Deck ${deckId} not found` }
      return
    }

    // Declared out here so the `finally` can release the pool regardless of
    // where we exit. Assigned inside the try so a pool-warmup failure flips the
    // deck to 'failed' through the normal error path.
    let concurrency = 1
    let pooled = false

    try {
      // Warm the parallel decode pool. `slots > 0` means questions (and themes)
      // can be generated concurrently across GPU sequences; 0 means no pool, so
      // we stay strictly serial — the shared chat session can't be driven by two
      // concurrent prompts at once.
      if (llm.ensureGenerationPool) {
        const slots = await llm.ensureGenerationPool(QUIZ_MAX_SLOTS, QUIZ_POOL_CONTEXT_TOKENS)
        if (slots > 0) {
          pooled = true
          concurrency = slots
        }
      }

      // ---- Stage 1: per-doc theme extraction ----
      // Serial, on the main chat session — see the note in themes.ts on why this
      // doesn't use the pool. It's only 1–3 calls, so serial costs ~nothing.
      yield { type: 'stage', stage: 'extracting-themes' }
      const tThemes = Date.now()
      const docIds = deck.documentIds
      const themes: QuizTheme[] = []
      const targetPerDoc = Math.max(
        2,
        Math.ceil((deck.questionCount * TARGET_THEMES_FACTOR) / Math.max(1, docIds.length)),
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

      quizDebug(
        `[quiz] themes: ${themes.length} from ${docIds.length} doc(s) in ${Date.now() - tThemes}ms (pool=${pooled ? concurrency : 'serial'})`,
      )

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

      // ---- Stage 3: order themes by weight ----
      yield { type: 'stage', stage: 'allocating' }

      // ---- Stage 4: batched question generation ----
      const accepted: AcceptedQuestion[] = []
      // Pre-fetch grounding for EVERY merged theme. Each theme is one batch
      // candidate; extra themes beyond what we need are a fresh-content buffer
      // for batches that come back short (so we never re-grind an exhausted
      // theme into duplicates).
      const groundingByTheme = new Map<string, ChunkRow[]>()
      for (const theme of merged) {
        if (abortSignal?.aborted) throw new Error('cancelled')
        groundingByTheme.set(theme.id, await this.resolveGrounding(deck.workspaceId, theme))
      }

      // Batch candidates: themes by weight, only those with grounding. When
      // there are fewer themes than batches we need (few-themes / many-questions),
      // cycle through them round-robin — each reuse sees a bigger avoid-list, so
      // the model keeps producing distinct questions.
      const grounded = [...merged]
        .sort((a, b) => b.weight - a.weight)
        .filter((t) => (groundingByTheme.get(t.id)?.length ?? 0) > 0)
      if (grounded.length === 0) {
        await quizzes.setDeckStatus(deckId, 'failed', 'no grounding for any theme')
        yield { type: 'error', message: 'no grounding for any theme' }
        return
      }
      const batchesNeeded = Math.ceil(deck.questionCount / QUIZ_BATCH_SIZE)
      const maxBatches = Math.max(grounded.length, batchesNeeded * 3)
      const batchQueue: QuizTheme[] = Array.from(
        { length: maxBatches },
        (_, i) => grounded[i % grounded.length]!,
      )

      let cursor = 0
      let consecutiveEmptyWaves = 0
      // Each batch asks one theme for QUIZ_BATCH_SIZE distinct questions in a
      // single call; a wave runs up to `concurrency` batches in parallel. Stop
      // at the target, when the queue drains, or after two waves in a row that
      // add nothing new.
      while (accepted.length < deck.questionCount && cursor < batchQueue.length) {
        if (abortSignal?.aborted) throw new Error('cancelled')
        const need = deck.questionCount - accepted.length
        const wantBatches = Math.min(concurrency, Math.ceil(need / QUIZ_BATCH_SIZE))
        const wave: QuizTheme[] = []
        while (wave.length < wantBatches && cursor < batchQueue.length) {
          wave.push(batchQueue[cursor]!)
          cursor += 1
        }
        if (wave.length === 0) break
        const avoidSnapshot = accepted.slice()
        const tWave = Date.now()
        const results = await Promise.all(
          wave.map((theme) =>
            generateQuestionBatch(llm, embedder, {
              language: deck.language,
              theme,
              groundingChunks: groundingByTheme.get(theme.id)!,
              accepted: avoidSnapshot,
              count: QUIZ_BATCH_SIZE,
              ...(pooled ? { pooled: true } : {}),
              ...(abortSignal ? { abortSignal } : {}),
            }).catch((err: unknown) => {
              if (err instanceof Error && err.message === 'cancelled') throw err
              return { questions: [] }
            }),
          ),
        )
        const waveMs = Date.now() - tWave
        let waveAccepted = 0
        let waveGenerated = 0
        for (const r of results) {
          for (const q of r.questions) {
            waveGenerated += 1
            if (accepted.length >= deck.questionCount) break
            // Cross-batch dedup: batches in the same wave shared one avoid-list
            // snapshot, so re-check each survivor against the live accepted set.
            if (isStemDuplicate(q.stemEmbedding, accepted)) continue
            accepted.push({ ...q, ordinal: accepted.length })
            waveAccepted += 1
            yield {
              type: 'question',
              ordinal: accepted.length,
              total: deck.questionCount,
            }
          }
        }
        quizDebug(
          `[quiz] wave: ${wave.length} batch → ${waveGenerated} gen, ${waveAccepted} kept in ${waveMs}ms (total ${accepted.length}/${deck.questionCount})`,
        )
        if (waveAccepted === 0) {
          consecutiveEmptyWaves += 1
          if (consecutiveEmptyWaves >= 2) break
        } else {
          consecutiveEmptyWaves = 0
        }
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
    } finally {
      // Hand the pool's KV-cache VRAM back — quizzes are infrequent, so we don't
      // keep N sequences resident between generations.
      if (pooled && llm.releaseGenerationPool) {
        try {
          await llm.releaseGenerationPool()
        } catch {
          /* worker down or pool already gone — nothing to free */
        }
      }
    }
  }

  /** Resolve grounding chunks for a theme. Whole-doc themes carry IDs from
   *  Stage 1 → load by id. Outline themes have empty groundingChunkIds → use
   *  the retrieval index keyed on the theme title, scoped to the theme's doc. */
  private async resolveGrounding(workspaceId: number, theme: QuizTheme): Promise<ChunkRow[]> {
    const documents = this.db.documents()
    if (theme.groundingChunkIds.length > 0) {
      const allChunks = await documents.listChunksForDocument(theme.docId)
      const allowed = new Set(theme.groundingChunkIds)
      // Whole-doc themes have ALL chunks attached. Top-K trim so the prompt
      // doesn't blow the context window. We pick the longest chunks because
      // they tend to be most useful for question writing.
      const filtered = allChunks.filter((c) => allowed.has(c.id))
      // 3 chunks is enough grounding to write ONE MCQ; the prefill is paid per
      // question, and on a compute-bound 9B that prefill is most of each call.
      return filtered
        .slice()
        .sort((a, b) => (b.token_count ?? 0) - (a.token_count ?? 0))
        .slice(0, 3)
        .sort((a, b) => a.ordinal - b.ordinal)
    }
    // Outline path: retrieve top-K relevant chunks for the theme title,
    // scoped to this theme's source document.
    const hits = await this.retrieval.search(workspaceId, `${theme.title} — ${theme.summary}`, 5, {
      activeDocumentIds: [theme.docId],
    })
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
