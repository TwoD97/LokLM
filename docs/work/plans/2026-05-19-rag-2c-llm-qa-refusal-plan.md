# RAG Pipeline 2C — LLM + QA + Refusal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **Do NOT commit per task** — the controller batches everything into one final commit at the end.

**Spec:** [Spec 2 — RAG Pipeline on AP-4.4 Outline](https://notes.ltwodl.com/doc/ap-44-rrf-fusion-in-retrievalservice-oV1wEBsVI0). This sub-plan covers **AP-7.2** (LlamaService + prompt + QAService streaming API) and **AP-7.4** (refusal threshold + fallback synthesis). After 2C lands, the eval harness (AP-E.2) can drive `QAService.answer(workspaceId, query)` end-to-end.

**Branch:** `release/v0.2-rag` (head: `9958344 Spec 2b`).

**Goal:** Land a streaming `QAService.answer(workspaceId, query, opts) → AsyncIterable<StreamEvent>` API that retrieves hits via `RetrievalService`, builds a citation-disciplined prompt, streams tokens from a bundled Qwen3-8B GGUF, and short-circuits to a refusal string when no hit clears the threshold.

**Architecture:** Port the MVP's `LlamaService` verbatim (Qwen3-8B-Q4_K_M, adaptive backend, `/no_think` directive, `<think>` filter). Add a thin `QAService` on top that orchestrates: retrieve → threshold check → prompt build → stream → citation event emission. Wire `LlamaService` into the previously stubbed `LlamaServiceLike` slot on `RetrievalService` so multi-query expansion comes alive.

**Naming note:** Our `QAService` is the streaming RAG-answer entry-point. The MVP repo has a *different* `QAService` (a study-Q&A generator). We do **not** port that one — it's a separate AP outside Spec 2.

**Tech Stack:** `node-llama-cpp` ^3.18.1 (already on dep tree), pre-existing retrieval + embedder + reranker stack from Plans 2A/2B.

---

## File Structure

**New files:**
- `src/main/services/llm/LlamaService.ts` — verbatim port from MVP (~1087 lines) with import-path + type-export adaptations
- `src/main/services/llm/prompt.ts` — extracted from MVP's `LlamaService.ts` (the inline `buildPrompt`, `renderFallback`, `condense`, `chunkifyForStream`, `stripThink`, `ThinkFilter` class)
- `src/main/services/qa/QAService.ts` — thin orchestrator: search → threshold → prompt → stream
- `src/main/services/qa/types.ts` — `StreamEvent`, `AnswerOptions`, `AnswerResult`
- `tests/unit/prompt.test.ts` — token-budget enforcement + history truncation + source-block format
- `tests/integration/qa-answer.test.ts` — end-to-end gated on model files

**Modified files:**
- `scripts/download-models.mjs` — verify Qwen3-8B entry still resolves (URL stability check); add new `pnpm models:llm` script that hits the `medium` tier without the full `all` download
- `src/main/db/database.ts` — small addition: `getDocument()` already exists, but `RetrievalService` may need `expandChunksWithContext` (added in 2B if not yet). Verify and reuse.
- `src/main/services/retrieval/RetrievalService.ts` — replace the `LlamaServiceLike` forward declaration with the real `LlamaService` import; remove the stub interface
- `src/main/index.ts` — instantiate `LlamaService` + `QAService` singletons; register IPC handlers `chat:stream`, `chat:cancel`, `llm:status`, `llm:info`, `llm:reload`, `llm:setProfile`, `llm:setPlacement`; wire `getRetrievalService()` to pass the LlamaService instead of `undefined`
- `src/preload/index.ts` — expose `window.api.chat.*` + `window.api.llm.*`
- `src/renderer/src/setupTests.ts` — stub the new API
- `src/shared/documents.ts` — add `ModelState`, `ModelStatus`, `SystemInfo`, `LlmProfileName`, `LlmProfileChoice`, `StreamEvent`, `AnswerOptions`, `RefusalReason`, `ResponseLanguage`

**MVP files to port** (via `gh api repos/TwoD97/Notebook-LoLM/contents/...`):
- `src/main/services/LlamaService.ts` — 1087 lines

---

## Pre-flight

- [ ] `git status` clean on `release/v0.2-rag` apart from the user's `docs/superpowers/plans/` untracked dir.
- [ ] Plan 2B is committed at `9958344` (head); `RetrievalService.ts` exists with the `LlamaServiceLike` forward decl in place.
- [ ] `pnpm models:medium` will produce `models/Qwen_Qwen3-8B-Q4_K_M.gguf` (~5 GB) — verify the URL is reachable via `curl -ILf` but do **not** download the model (user will run the script when ready).

---

## Task 1: Port LlamaService.ts

**Files:**
- Create: `src/main/services/llm/LlamaService.ts` (port + adapt)
- Create: `src/main/services/llm/prompt.ts` (extract pure helpers from MVP)

### Step 1: Fetch from MVP

```bash
mkdir -p src/main/services/llm
gh api repos/TwoD97/Notebook-LoLM/contents/src/main/services/LlamaService.ts --jq '.content' | base64 -d > src/main/services/llm/LlamaService.ts
```

### Step 2: Extract pure helpers into `src/main/services/llm/prompt.ts`

The MVP's `LlamaService.ts` has these pure (non-class) helpers near the bottom:
- `buildPrompt(question, hits, history?)` — assembles the prompt
- `renderFallback(question, hits, lang)` — citation-only fallback when LLM unavailable
- `condense(text, max)` — text truncation utility
- `chunkifyForStream(text)` — chunks a non-streamed string into faux stream chunks
- `stripThink(text)` — removes `<think>…</think>` blocks
- class `ThinkFilter` — stateful streaming filter for `<think>` blocks
- `HISTORY_MESSAGE_CHAR_CAP`, `HISTORY_TRUNCATION_MARKER` constants
- `REFUSAL_TEXT: Record<ResponseLanguage, string>` constant
- `buildSystemPrompt(lang)` function

Move all of those to a new file `src/main/services/llm/prompt.ts`. Export each so LlamaService can re-import:

```ts
// src/main/services/llm/prompt.ts header
import type { RetrievalHit } from '@shared/documents'

export type ResponseLanguage = 'de' | 'en'
// … (paste extracted helpers + class)
```

In `LlamaService.ts`, replace the deleted inline declarations with:
```ts
import {
  buildPrompt,
  renderFallback,
  buildSystemPrompt,
  ThinkFilter,
  stripThink,
  chunkifyForStream,
  REFUSAL_TEXT,
  type ResponseLanguage,
} from './prompt'
```

### Step 3: Import path adaptations

The MVP imports look like:
```ts
import { ResourcePlanner, ggufWeightBytes, ... } from './ResourcePlanner'
import type { RetrievalHit } from './RetrievalService'
```

Change to:
```ts
import { ResourcePlanner, ggufWeightBytes, ... } from '../embeddings/ResourcePlanner'
import type { RetrievalHit } from '../../../shared/documents'
```

(`RetrievalHit` is already declared in shared/documents.ts from Plan 2B. The MVP imported it from RetrievalService — we use the shared type for renderer consistency.)

### Step 4: Type re-exports — single source of truth

In `src/shared/documents.ts`, append:
```ts
export type ModelState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'
export type LlmProfileName = 'lite' | 'full' | 'xl'
export type LlmProfileChoice = 'auto' | LlmProfileName

export interface ModelStatus {
  kind: 'llm'
  state: ModelState
  profile: LlmProfileName | null
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
  contextSize: number | null
}

export interface AvailableProfile {
  name: LlmProfileName
  filename: string
  displayName: string
  weightsBytes: number
  exists: boolean
}

export interface SystemInfo extends ModelStatus {
  available: AvailableProfile[]
  profileChoice: LlmProfileChoice
  placementChoice: 'auto' | 'cpu' | 'gpu'
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementReason: string | null
  totalMemGB: number
  contextChoice: number | 'auto'
}
```

In `src/main/services/llm/LlamaService.ts`, replace the local declarations of `ModelState`, `ModelStatus`, `SystemInfo`, `LlmProfileName`, `LlmProfileChoice`, `AvailableProfile` (around lines 13–104 of the MVP file) with:
```ts
import type {
  ModelState,
  ModelStatus,
  SystemInfo,
  LlmProfileName,
  LlmProfileChoice,
  AvailableProfile,
} from '../../../shared/documents'
export type {
  ModelState,
  ModelStatus,
  SystemInfo,
  LlmProfileName,
  LlmProfileChoice,
  AvailableProfile,
}
```

Keep `LLM_PROFILES`, `AskOptions`, and other internal types local to LlamaService.

### Step 5: TS strict-mode fixes

After all the rewrites, run:
```bash
pnpm typecheck 2>&1 | grep -E "LlamaService\.ts|prompt\.ts"
```

For each error, apply the same patterns we used in Plan 2A/2B:
- `'string | undefined' is not assignable` → `!` non-null assertion when bounds-checked
- `Object is possibly 'undefined'` → guard with `if (!x) continue` or `!` if proven
- Drizzle row casts (none expected here — LlamaService doesn't touch the DB directly)

### Step 6: Verify typecheck clean

```bash
pnpm typecheck
```

### Step 7: NO COMMIT.

---

## Task 2: Wire LlamaService into RetrievalService

**Files:**
- Modify: `src/main/services/retrieval/RetrievalService.ts`

### Step 1: Remove the forward declaration

Find this block at the top of `RetrievalService.ts` (added in Plan 2B Task 4):
```ts
// LlamaService isn't ported yet (lands in Plan 2C). Forward-declare …
interface LlamaServiceLike {
  isReady(): boolean
  complete(prompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string>
}
type LlamaService = LlamaServiceLike
```

Delete it. Replace with:
```ts
import type { LlamaService } from '../llm/LlamaService'
```

### Step 2: Verify `maybeExpandQueries` still type-checks

The MVP's `maybeExpandQueries` calls `this.llama!.complete(...)`. The real `LlamaService` may expose a different generation entry-point (likely `generateRaw` based on the source). If `complete` doesn't exist on `LlamaService`:

- **Option A:** Add a `complete()` method on `LlamaService` that wraps `generateRaw()` with the same signature `(prompt: string, opts?: { maxTokens?: number; temperature?: number }) => Promise<string>`.
- **Option B:** Update `maybeExpandQueries` to call `this.llama.generateRaw(prompt, { maxTokens })`.

Inspect `LlamaService.ts` to see which method actually exists. Choose Option B if `generateRaw` is already there with a compatible signature; Option A if neither matches and a small wrapper keeps the call site readable.

### Step 3: Typecheck clean

```bash
pnpm typecheck
```

### Step 4: NO COMMIT.

---

## Task 3: prompt.ts unit tests (TDD)

**Files:**
- Create: `tests/unit/prompt.test.ts`

### Step 1: Write tests against the extracted prompt helpers

```ts
import { describe, it, expect } from 'vitest'
import {
  buildPrompt,
  buildSystemPrompt,
  renderFallback,
  stripThink,
  ThinkFilter,
  REFUSAL_TEXT,
} from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

const hit = (id: number, text: string, title = 'doc.md'): RetrievalHit => ({
  chunk_id: id,
  document_id: id,
  document_title: title,
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  text,
  score: 1.0,
})

describe('buildPrompt', () => {
  it('emits source block with [doc:X, chunk:Y] markers', () => {
    const out = buildPrompt('was steht da?', [hit(5, 'Wir testen Wochenbuch.', 'Wochenbuch.pdf')])
    expect(out).toContain('[doc:5, chunk:5]')
    expect(out).toContain('Wochenbuch.pdf')
    expect(out).toContain('Wir testen Wochenbuch.')
    expect(out).toContain('was steht da?')
  })

  it('omits source block when no hits', () => {
    const out = buildPrompt('hello', [])
    expect(out).toContain('Context: (none)')
  })

  it('embeds conversation history when provided', () => {
    const out = buildPrompt('follow up', [hit(1, 'fact one')], [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
    ])
    expect(out).toContain('first question')
    expect(out).toContain('first answer')
    expect(out).toMatch(/Previous conversation/i)
  })

  it('truncates oversized history messages', () => {
    const huge = 'x'.repeat(5000)
    const out = buildPrompt('q', [hit(1, 'fact')], [{ role: 'user', content: huge }])
    expect(out.length).toBeLessThan(huge.length + 2000)
    expect(out).toContain('truncated')
  })
})

describe('buildSystemPrompt', () => {
  it('contains citation discipline + refusal instruction', () => {
    const sys = buildSystemPrompt('de')
    expect(sys.toLowerCase()).toMatch(/doc:|chunk:|quell/i)
  })

  it('contains /no_think directive', () => {
    const sys = buildSystemPrompt('en')
    expect(sys).toMatch(/no_think/)
  })
})

describe('stripThink + ThinkFilter', () => {
  it('removes <think>…</think> blocks', () => {
    expect(stripThink('hello <think>internal</think> world')).toBe('hello  world')
  })

  it('handles streamed <think> blocks across chunk boundaries', () => {
    const filter = new ThinkFilter()
    const parts = ['hello <thi', 'nk>x</thi', 'nk> world']
    const out = parts.map((p) => filter.push(p)).join('') + filter.flush()
    expect(out).toBe('hello  world')
  })

  it('passes through text with no thinking tags untouched', () => {
    const filter = new ThinkFilter()
    expect(filter.push('clean text')).toBe('clean text')
    expect(filter.flush()).toBe('')
  })
})

describe('renderFallback', () => {
  it('returns a citation-listing string when hits exist', () => {
    const out = renderFallback('q', [hit(2, 'snippet')], 'de')
    expect(out).toContain('[doc:2, chunk:2]')
  })

  it('returns a refusal string when no hits', () => {
    const out = renderFallback('q', [], 'de')
    expect(out).toBe(REFUSAL_TEXT.de)
  })
})

describe('REFUSAL_TEXT', () => {
  it('has both de and en variants, non-empty', () => {
    expect(REFUSAL_TEXT.de.length).toBeGreaterThan(0)
    expect(REFUSAL_TEXT.en.length).toBeGreaterThan(0)
    expect(REFUSAL_TEXT.de).not.toBe(REFUSAL_TEXT.en)
  })
})
```

### Step 2: Run, confirm pass

```bash
pnpm test --project unit
```

Expected: 31 existing unit tests + ~13 new prompt tests = ~44 unit tests pass. If a specific assertion fails because the MVP wording differs from these expectations (e.g., the refusal string format), adapt the assertion to what `prompt.ts` actually exports — don't change the export. (Goal is to verify behaviour, not pin exact wording.)

### Step 3: NO COMMIT.

---

## Task 4: QAService — the streaming orchestrator

**Files:**
- Create: `src/main/services/qa/QAService.ts`
- Create: `src/main/services/qa/types.ts`

### Step 1: Define stream event types in `src/main/services/qa/types.ts`

```ts
import type { RetrievalHit } from '@shared/documents'

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'citation'; doc_id: number; chunk_id: number; score: number }
  | { type: 'refusal'; reason: 'no_hits' | 'below_threshold'; message: string; suggestions: Array<{ doc_id: number; title: string; score: number }> }
  | { type: 'error'; message: string }
  | { type: 'done'; full_text: string; citations: Array<{ doc_id: number; chunk_id: number; score: number }> }

export interface AnswerOptions {
  topK?: number
  refusalThreshold?: number
  language?: 'de' | 'en'
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  abortSignal?: AbortSignal
  // pass-through to RetrievalService
  rerank?: boolean
  multiQuery?: boolean
  activeDocumentIds?: number[] | null
}

export interface AnswerResult {
  answer: string
  citations: Array<{ doc_id: number; chunk_id: number; score: number }>
  refused: boolean
}
```

Mirror `StreamEvent` + `AnswerOptions` + `AnswerResult` in `src/shared/documents.ts` for renderer/IPC consistency, then re-export from `qa/types.ts` (same pattern as `RerankerStatus`).

### Step 2: Write `QAService` in `src/main/services/qa/QAService.ts`

```ts
import type { Database } from '../../db/database'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { LlamaService } from '../llm/LlamaService'
import type { RetrievalHit } from '@shared/documents'
import type { StreamEvent, AnswerOptions } from './types'
import { REFUSAL_TEXT } from '../llm/prompt'

const DEFAULT_TOP_K = 8
const DEFAULT_REFUSAL_THRESHOLD = 0.3

/**
 * Streaming RAG entry-point. Pipeline:
 *   1. Retrieve hybrid hits via RetrievalService.search
 *   2. If 0 hits OR top score < threshold → emit `refusal` and finish
 *   3. Otherwise build prompt + stream tokens via LlamaService
 *   4. Emit `citation` events for each retrieved hit
 *   5. Emit `done` with the full text + citation list
 *
 * Caller consumes this as an AsyncIterable. The eval harness in AP-E.2
 * collects events to a final {answer, citations, refused}.
 */
export class QAService {
  constructor(
    private readonly db: Database,
    private readonly retrieval: RetrievalService,
    private readonly llama: LlamaService,
  ) {}

  async *answer(
    workspaceId: number,
    query: string,
    opts: AnswerOptions = {},
  ): AsyncIterable<StreamEvent> {
    const topK = opts.topK ?? DEFAULT_TOP_K
    const threshold = opts.refusalThreshold ?? DEFAULT_REFUSAL_THRESHOLD
    const language = opts.language ?? detectLanguage(query)

    let hits: RetrievalHit[] = []
    try {
      hits = await this.retrieval.search(workspaceId, query, topK, {
        rerank: opts.rerank ?? false,
        multiQuery: opts.multiQuery ?? false,
        activeDocumentIds: opts.activeDocumentIds ?? null,
      })
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      }
      return
    }

    // refusal path: no hits OR top hit below threshold
    const topScore = hits[0]?.score ?? 0
    if (hits.length === 0 || topScore < threshold) {
      const reason = hits.length === 0 ? 'no_hits' : 'below_threshold'
      const message = REFUSAL_TEXT[language]
      // suggest up to 3 best near-miss docs so the user can re-phrase
      const suggestions = uniqueByDoc(hits, 3).map((h) => ({
        doc_id: h.document_id,
        title: h.document_title,
        score: h.score,
      }))
      yield { type: 'refusal', reason, message, suggestions }
      yield { type: 'done', full_text: message, citations: [] }
      return
    }

    // generation path
    const collected: string[] = []
    const pieces: string[] = []
    const collector = (chunk: string): void => {
      collected.push(chunk)
      pieces.push(chunk)
    }

    // emit citations up-front so the renderer can show source chips while
    // tokens are still streaming
    const citations = hits.map((h) => ({
      doc_id: h.document_id,
      chunk_id: h.chunk_id,
      score: h.score,
    }))
    for (const c of citations) {
      yield { type: 'citation', ...c }
    }

    try {
      const askPromise = this.llama.ask(query, hits, {
        onTextChunk: collector,
        ...(opts.history ? { conversationHistory: opts.history } : {}),
        ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
        language,
      })
      // drain the collector buffer concurrently while ask() is in flight
      while (true) {
        // small yield interval — 10 ms keeps the loop responsive without
        // hammering the event queue
        if (pieces.length > 0) {
          while (pieces.length > 0) {
            yield { type: 'token', text: pieces.shift()! }
          }
        }
        const settled = await Promise.race([askPromise, sleep(15)])
        if (settled !== SLEEP_SENTINEL) break
      }
      await askPromise // ensure rejection propagates if any
      // flush any final buffered pieces
      while (pieces.length > 0) {
        yield { type: 'token', text: pieces.shift()! }
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      }
      return
    }

    yield {
      type: 'done',
      full_text: collected.join(''),
      citations,
    }
  }
}

const SLEEP_SENTINEL = Symbol('sleep')
function sleep(ms: number): Promise<typeof SLEEP_SENTINEL> {
  return new Promise((r) => setTimeout(() => r(SLEEP_SENTINEL), ms))
}

function uniqueByDoc(hits: RetrievalHit[], limit: number): RetrievalHit[] {
  const seen = new Set<number>()
  const out: RetrievalHit[] = []
  for (const h of hits) {
    if (seen.has(h.document_id)) continue
    seen.add(h.document_id)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

function detectLanguage(query: string): 'de' | 'en' {
  // Crude: if the query contains common German function words or umlauts,
  // bias to de; otherwise en. Good enough for refusal text selection.
  if (/[äöüß]/i.test(query)) return 'de'
  if (/\b(was|wie|wer|wo|wann|warum|der|die|das|ist|sind)\b/i.test(query)) return 'de'
  return 'en'
}
```

### Step 3: Typecheck clean

```bash
pnpm typecheck
```

If `LlamaService.ask`'s `AskOptions` shape differs from the call we made (`onTextChunk` / `conversationHistory` / `abortSignal` / `language`), inspect the actual MVP `AskOptions` interface (it's around line 121 of LlamaService.ts) and align.

### Step 4: NO COMMIT.

---

## Task 5: Integration test — QAService end-to-end

**Files:**
- Create: `tests/integration/qa-answer.test.ts`

Gated on both Qwen3-8B AND BGE-M3 being present locally.

### Step 1: Write the test

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import { LlamaService } from '@main/services/llm/LlamaService'
import { QAService } from '@main/services/qa/QAService'
import type { IndexProgress } from '@main/services/documents/types'
import type { StreamEvent } from '@main/services/qa/types'

const EMBEDDER_PATH = join(process.cwd(), 'models', 'bge-m3-Q4_K_M.gguf')
const LLM_PATH = join(process.cwd(), 'models', 'Qwen_Qwen3-8B-Q4_K_M.gguf')

describe.runIf(existsSync(EMBEDDER_PATH) && existsSync(LLM_PATH))('QAService.answer (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-qa-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('streams a grounded answer with citations on a seeded corpus', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const filePath = join(dir, 'argon-doc.md')
    await writeFile(
      filePath,
      '# Auth design\n\nPasswords in LokLM are hashed with argon2id at 64 MiB memory cost, ' +
        '3 iterations, parallelism 4, producing a 32-byte raw hash. The vault uses AES-256-GCM ' +
        'envelope encryption with a passphrase-derived KEK.',
      'utf-8',
    )

    const embedder = new EmbeddingService()
    expect(await embedder.ensureReady()).toBe(true)

    const docs = new DocumentService(auth, embedder)
    const sent: IndexProgress[] = []
    await docs.importFile({
      workspaceId: ws.id,
      sourcePath: filePath,
      sender: {
        send: (_c: string, e: IndexProgress) => sent.push(e),
      } as unknown as Electron.WebContents,
    })
    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 30_000)

    const db = auth.requireDatabase()
    const llama = new LlamaService()
    expect(await llama.ensureReady()).toBe(true)
    const retrieval = new RetrievalService(db, embedder, undefined, llama)
    const qa = new QAService(db, retrieval, llama)

    const events: StreamEvent[] = []
    for await (const ev of qa.answer(ws.id, 'How are passwords hashed?', { topK: 4 })) {
      events.push(ev)
    }

    const tokens = events.filter((e) => e.type === 'token')
    expect(tokens.length).toBeGreaterThan(0)
    const done = events.find((e) => e.type === 'done')
    expect(done).toBeDefined()
    expect(done!.full_text.toLowerCase()).toContain('argon2')
    const citations = events.filter((e) => e.type === 'citation')
    expect(citations.length).toBeGreaterThan(0)

    await llama.unload()
    await embedder.unload()
  }, 360_000)

  it('emits refusal when no relevant doc exists', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const filePath = join(dir, 'cooking.md')
    await writeFile(
      filePath,
      '# Pancake\nFlour, milk, egg, butter. Mix, rest, fry.',
      'utf-8',
    )

    const embedder = new EmbeddingService()
    expect(await embedder.ensureReady()).toBe(true)
    const docs = new DocumentService(auth, embedder)
    const sent: IndexProgress[] = []
    await docs.importFile({
      workspaceId: ws.id,
      sourcePath: filePath,
      sender: {
        send: (_c: string, e: IndexProgress) => sent.push(e),
      } as unknown as Electron.WebContents,
    })
    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 30_000)

    const db = auth.requireDatabase()
    const llama = new LlamaService()
    expect(await llama.ensureReady()).toBe(true)
    const retrieval = new RetrievalService(db, embedder, undefined, llama)
    const qa = new QAService(db, retrieval, llama)

    const events: StreamEvent[] = []
    for await (const ev of qa.answer(ws.id, 'wie schütze ich passwörter', {
      refusalThreshold: 0.9, // force refusal regardless of actual top score
    })) {
      events.push(ev)
    }
    const refusal = events.find((e) => e.type === 'refusal')
    expect(refusal).toBeDefined()
    expect(refusal!.message).toMatch(/find|nicht/i)

    await llama.unload()
    await embedder.unload()
  }, 240_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
```

### Step 2: typecheck only — skip the test run (would need model files)

```bash
pnpm typecheck
```

### Step 3: NO COMMIT.

---

## Task 6: IPC handlers + preload + stubs

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/setupTests.ts`

### Step 1: Singletons + handlers in `src/main/index.ts`

After the existing retrieval/reranker singletons, add:

```ts
import { LlamaService } from './services/llm/LlamaService'
import { QAService } from './services/qa/QAService'

let llamaService: LlamaService | null = null
let qaService: QAService | null = null

function getLlamaService(): LlamaService {
  if (!llamaService) {
    llamaService = new LlamaService()
    llamaService.subscribe((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('llm:status', status)
        } catch {
          /* ignore */
        }
      }
    })
  }
  return llamaService
}

function getQAService(): QAService {
  if (!qaService) {
    qaService = new QAService(
      getAuth().requireDatabase(),
      getRetrievalService(),
      getLlamaService(),
    )
  }
  return qaService
}
```

Update `getRetrievalService()` to pass the real LlamaService (replacing the `undefined` placeholder):
```ts
function getRetrievalService(): RetrievalService {
  if (!retrievalService) {
    retrievalService = new RetrievalService(
      getAuth().requireDatabase(),
      getEmbeddingService(),
      getRerankerService(),
      getLlamaService(),
    )
  }
  return retrievalService
}
```

Update `resetSessionServices` to drop `qaService` too (it captures Database):
```ts
function resetSessionServices(): void {
  backfillService = null
  retrievalService = null
  qaService = null
}
```

Register handlers inside `registerIpc()`:
```ts
  // llm
  ipcMain.handle('llm:status', async () => getLlamaService().getStatus())
  ipcMain.handle('llm:info', async () => getLlamaService().info())
  ipcMain.handle('llm:reload', async () => {
    await getLlamaService().unload()
    await getLlamaService().ensureReady()
    return getLlamaService().info()
  })
  ipcMain.handle(
    'llm:setProfile',
    async (_e, choice: import('../shared/documents').LlmProfileChoice) => {
      getLlamaService().setProfile(choice)
    },
  )
  ipcMain.handle(
    'llm:setPlacement',
    async (_e, choice: 'auto' | 'cpu' | 'gpu') => {
      getLlamaService().setPlacement(choice)
    },
  )

  // chat streaming (one stream per (sender, id) — caller assigns id)
  const activeStreams = new Map<string, AbortController>()
  ipcMain.handle(
    'chat:stream',
    async (
      e,
      streamId: string,
      workspaceId: number,
      query: string,
      opts: import('../shared/documents').AnswerOptions = {},
    ) => {
      const ctrl = new AbortController()
      activeStreams.set(streamId, ctrl)
      try {
        const stream = getQAService().answer(workspaceId, query, {
          ...opts,
          abortSignal: ctrl.signal,
        })
        for await (const ev of stream) {
          try {
            e.sender.send(`chat:stream-event:${streamId}`, ev)
          } catch {
            /* renderer gone, abort */
            ctrl.abort()
            break
          }
        }
      } finally {
        activeStreams.delete(streamId)
      }
    },
  )
  ipcMain.handle('chat:cancel', async (_e, streamId: string) => {
    activeStreams.get(streamId)?.abort()
  })
```

The handler-method names match what `src/preload/index.ts` will invoke.

### Step 2: Extend preload `src/preload/index.ts`

Add to the imports:
```ts
import type {
  ModelStatus,
  SystemInfo,
  LlmProfileChoice,
  AnswerOptions,
  StreamEvent,
} from '../shared/documents'
```

Add to the `api` object:
```ts
  llm: {
    status: (): Promise<ModelStatus> => ipcRenderer.invoke('llm:status'),
    info: (): Promise<SystemInfo> => ipcRenderer.invoke('llm:info'),
    reload: (): Promise<SystemInfo> => ipcRenderer.invoke('llm:reload'),
    setProfile: (choice: LlmProfileChoice): Promise<void> =>
      ipcRenderer.invoke('llm:setProfile', choice),
    setPlacement: (choice: 'auto' | 'cpu' | 'gpu'): Promise<void> =>
      ipcRenderer.invoke('llm:setPlacement', choice),
    onStatus: (cb: (s: ModelStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: ModelStatus): void => cb(s)
      ipcRenderer.on('llm:status', listener)
      return () => {
        ipcRenderer.removeListener('llm:status', listener)
      }
    },
  },
  chat: {
    stream: (
      streamId: string,
      workspaceId: number,
      query: string,
      opts?: AnswerOptions,
    ): Promise<void> =>
      ipcRenderer.invoke('chat:stream', streamId, workspaceId, query, opts ?? {}),
    cancel: (streamId: string): Promise<void> => ipcRenderer.invoke('chat:cancel', streamId),
    onEvent: (streamId: string, cb: (ev: StreamEvent) => void): (() => void) => {
      const channel = `chat:stream-event:${streamId}`
      const listener = (_e: IpcRendererEvent, ev: StreamEvent): void => cb(ev)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
```

### Step 3: Stub `src/renderer/src/setupTests.ts`

```ts
  llm: {
    status: () =>
      Promise.resolve({
        kind: 'llm' as const,
        state: 'idle' as const,
        profile: null,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        contextSize: null,
      }),
    info: () =>
      Promise.resolve({
        kind: 'llm' as const,
        state: 'idle' as const,
        profile: null,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        contextSize: null,
        available: [],
        profileChoice: 'auto' as const,
        placementChoice: 'auto' as const,
        resolvedPlacement: null,
        placementReason: null,
        totalMemGB: 0,
        contextChoice: 'auto' as const,
      }),
    reload: () =>
      Promise.resolve({
        kind: 'llm' as const,
        state: 'idle' as const,
        profile: null,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        contextSize: null,
        available: [],
        profileChoice: 'auto' as const,
        placementChoice: 'auto' as const,
        resolvedPlacement: null,
        placementReason: null,
        totalMemGB: 0,
        contextChoice: 'auto' as const,
      }),
    setProfile: () => Promise.resolve(),
    setPlacement: () => Promise.resolve(),
    onStatus: () => () => undefined,
  },
  chat: {
    stream: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    onEvent: () => () => undefined,
  },
```

### Step 4: typecheck + lint clean

```bash
pnpm typecheck && pnpm lint
```

### Step 5: NO COMMIT.

---

## Task 7: Final verification

### Step 1: Full test sweep

```bash
pnpm test
```

Expected:
- `unit`: ~44 pass (31 existing + ~13 prompt tests)
- `tx`: 25 pass + 1 pre-existing vault failure
- `integration`: 7 pass + 3 skipped (embedding-backfill, retrieval-pipeline, qa-answer — all need model files)
- `web`: 2 pass
- `node`: 3 pass

### Step 2: typecheck + lint clean

```bash
pnpm typecheck && pnpm lint
```

### Step 3: NO COMMIT. Hand back to the controller for the milestone commit.

---

## Self-Review

### Spec coverage (Plan 2C scope: AP-7.2 + AP-7.4)

| Spec section | Task | Notes |
|---|---|---|
| AP-7.2 LlamaService Qwen3-8B + adaptive backend | 1 | Verbatim port; `/no_think` directive + `<think>` filter included |
| AP-7.2 prompt.ts (citation markers + token budget) | 1, 3 | Extracted from MVP, 13+ unit tests |
| AP-7.2 QAService.answer streaming AsyncIterable | 4 | Orchestrator: retrieve → threshold → prompt → stream |
| AP-7.2 IPC chat:stream + chat:cancel | 6 | Programmatic API for eval harness |
| AP-7.2 multi-query expansion (gated on LlamaService) | 2 | Forward decl in RetrievalService replaced with real import |
| AP-7.4 refusal threshold + did-you-mean | 4 | Threshold check + suggestions in refusal event |
| AP-7.4 fallback synthesis (no LLM call when below threshold) | 4 | refusal path short-circuits before generation |

### Out of scope for 2C (separate APs)

- Chat UI (AP-7.1)
- Chat history persistence with `citations` table denormalisation (AP-7.5)
- Settings UI for profile / placement / refusal threshold (AP-9)
- Search results page with `ts_headline` highlighting (AP-6)
- Eval scoring harness itself (AP-E.2)

### Placeholder scan

- LlamaService.ts is a port — instructions name files + line ranges in MVP. No "TBD" markers.
- Both integration tests use `describe.runIf(existsSync(...))` to skip without model files.
- Test wording assertions use loose patterns (`/argon2/i`, `/find|nicht/i`) so model output variations don't break the test.

### Type consistency

- `RetrievalHit` lives in `src/shared/documents.ts`; LlamaService + QAService + RetrievalService all import from there.
- `ModelStatus` / `SystemInfo` / `LlmProfile*` mirrored into shared for renderer access; service re-exports the same type names so existing call sites compile.
- `StreamEvent` is the single contract between QAService and IPC; mirrored into shared so renderer subscribers type-check.
- `AskOptions` (LlamaService internal) and `AnswerOptions` (QAService public) are distinct. QAService translates between them in `qa.answer()`.

### Risks

- **node-llama-cpp version drift.** The MVP runs against `^3.18.1` (already on our dep tree from 2A). If a 3.x patch since release breaks LlamaService's `prompt()` / `getChatHistory()` API surface, the integration test surfaces it. Fall-back: pin the version in package.json.
- **Qwen3-8B model file size.** ~5 GB. The download script is set up but downloading is the user's responsibility (we do not run it in subagents).
- **Refusal threshold tuning.** Default 0.3 on the RRF-fused / heuristic-adjusted score scale. Different from the spec's "0.3 on reranker scale" because we don't run rerank by default in 2C — the threshold acts on whichever score the top hit has. This is acceptable; the eval harness in a follow-up AP will tune.
- **`maybeExpandQueries` API mismatch.** RetrievalService was written against `complete(prompt, opts)` but LlamaService may only expose `generateRaw(prompt, opts)`. Task 2 verifies + aligns; small risk this requires a wrapper.

---

## End of plan
