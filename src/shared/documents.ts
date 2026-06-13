import type { HighlightedSegment } from './fuzzyHighlight'

// renderer-visible shape of a document. mirrors src/main/db/schema.ts Document
// type but lives in src/shared so it's safe to import from the renderer , which
// can't reach into src/main.
export interface Document {
  id: number
  workspaceId: number
  title: string
  sourcePath: string
  mimeType: string | null
  byteSize: number | null
  status: 'pending' | 'indexing' | 'ready' | 'failed'
  chunkCount: number
  tokenCount: number
  addedAt: number
  /** sha256 of the source bytes at last (re)import. Null on pre-0004 rows. */
  contentHash?: string | null
  /** statSync().mtimeMs of the source at last (re)import, rounded to ms. */
  sourceMtime?: number | null
  /** Soft "source file vanished" marker — set by FolderSyncService and
   *  refreshDocument, cleared on rediscovery. Drives the LibraryView banner. */
  missingAt?: number | null
  /** When the user clicked "Behalten" on the banner. Suppresses re-notifying
   *  until the file reappears and vanishes again. */
  missingDismissedAt?: number | null
  /** Aggregated per-document language summary (mig 0007 / eld), computed
   *  on-the-fly by listDocumentsByWorkspace via GROUP BY over chunks.language:
   *    - 'de'    : ≥70 % of detected chunks tagged DE
   *    - 'en'    : ≥70 % of detected chunks tagged EN
   *    - 'mixed' : detected chunks split or majority is 'other'
   *    - null    : no chunks have a detected language (legacy / undetectable)
   *  Drives the library row badge. Single-doc fetches (`getDocument`) skip
   *  the aggregation so the field is omitted there. */
  language?: 'de' | 'en' | 'mixed' | null
  /** "Force into context" flag — set via Library row "Pin" action. When true,
   *  the QA packer prepends top-of-document chunks from this doc before RAG
   *  hits, so the model always sees it. Added in raw migration 0009; column is
   *  NOT NULL DEFAULT false, so this field is always present. */
  pinned: boolean
}

export interface Workspace {
  id: number
  name: string
  createdAt: number
}

export interface IndexProgress {
  documentId: number
  title: string
  phase: 'parsing' | 'chunking' | 'embedding' | 'persisting' | 'done' | 'failed'
  step: number
  total: number
  error?: string
  /** Optional sub-status for a long-running phase. The parsing phase sets this
   *  to scanned-page OCR progress (e.g. "OCR 3/40") so it doesn't look stalled. */
  detail?: string
}

export type EmbedderState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface EmbedderStatus {
  kind: 'embedder'
  state: EmbedderState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
  /** Which provider source is active — set by ProviderRegistry overlay in
   *  main/index.ts (the raw service always reports 'bundled'). Drives the
   *  status-dot color and Local/Remote label in the TitleBar. */
  source: 'bundled' | 'ollama'
}

export interface EmbedderInfo extends EmbedderStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementChoice: 'auto' | 'cpu' | 'gpu'
  placementReason: string | null
}

export interface BackfillStatus {
  workspaceId: number
  state: 'idle' | 'running' | 'done' | 'failed'
  done: number
  total: number
  message: string | null
}

export type RerankerState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface RerankerStatus {
  kind: 'reranker'
  state: RerankerState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
  /** See EmbedderStatus.source — same overlay pattern. */
  source: 'bundled' | 'ollama'
}

export interface RerankerInfo extends RerankerStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementChoice: 'auto' | 'cpu' | 'gpu'
  placementReason: string | null
}

export interface RetrievalHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  /** Hierarchical heading breadcrumb for markdown chunks (e.g. ["Intro", "Why MD"]).
   *  Null for PDFs and unstructured text. */
  heading_path: string[] | null
  text: string
  score: number
  origin?: 'primary' | 'neighbour' | 'whole_doc'
  /** Per-chunk detected language (mig 0007 / eld). 'de' | 'en' | 'other' when
   *  ingest ran post-0007, null for legacy chunks. Consumed by formatHitHeader
   *  to tag chunks whose language differs from the response language so the
   *  model knows it's translating quoted material rather than copying verbatim. */
  language: 'de' | 'en' | 'other' | null
}

// ---------------------------------------------------------------------------
// AP-6 Library search (Pflichtenheft §3.5) — renderer + preload + main agree.
// Lexical (BM25 + ts_headline) library search with filters + sort, distinct
// from the model-backed hybrid RetrievalService path above.
// ---------------------------------------------------------------------------

/** Filterable document-type buckets surfaced in the library search UI. Derived
 *  from the source-path extension (mime_type is null for most text/code files).
 *  'code' covers all code/markup extensions; 'txt' covers .txt/.rst + fallback. */
export type LibraryDocType = 'pdf' | 'md' | 'txt' | 'code' | 'docx'

/** Library result ordering. 'relevance' (ts_rank_cd) is the default; the other
 *  two are document-level orderings (one hit per document). */
export type LibrarySort = 'relevance' | 'filename' | 'added'

export interface LibrarySearchOptions {
  /** Restrict to these type buckets. Null/empty/all-five = no type filter. */
  types?: LibraryDocType[] | null
  /** Lower bound on documents.added_at (epoch SECONDS, matching the column).
   *  Null = no date filter. */
  addedAfter?: number | null
  /** Inclusive byte-size bounds on documents.byte_size. Null = unbounded. */
  minBytes?: number | null
  maxBytes?: number | null
  /** Result ordering. Default 'relevance'. */
  sort?: LibrarySort
  /** Max documents returned. Default 50. */
  topK?: number
}

/** One row per matching document (its best-scoring chunk). The excerpt is
 *  pre-split into segments in the main process from the ts_headline sentinels,
 *  so the renderer maps them to <mark>/<span> and never touches innerHTML. */
export interface LibrarySearchHit {
  chunkId: number
  documentId: number
  documentTitle: string
  docType: LibraryDocType
  /** PDF page range of the best chunk. Null for markdown/plain text. */
  pageFrom: number | null
  pageTo: number | null
  /** Heading breadcrumb for markdown chunks (shown when pageFrom is null). */
  headingPath: string[] | null
  score: number
  addedAt: number | null
  byteSize: number | null
  language: 'de' | 'en' | 'other' | null
  /** ts_headline excerpt as alternating plain/highlighted segments. */
  segments: HighlightedSegment[]
}

// ---------------------------------------------------------------------------
// LLM / LlamaService shared types — renderer + preload + main must agree.
// ---------------------------------------------------------------------------

/** Status of a single model from the download manifest. Renderer uses this
 *  to decide whether to show the first-launch download UI. */
export interface ModelAvailability {
  /** Stable id from the manifest (filename without `.gguf`). */
  id: string
  label: string
  description: string
  kind: 'llm' | 'embedder' | 'reranker'
  filename: string
  /** Expected size in bytes from the manifest. */
  sizeBytes: number
  /** Whether this model is required for the app to function. */
  required: boolean
  /** Resolved absolute path if the file is on disk; null otherwise. */
  resolvedPath: string | null
  /** True when the file exists AND its size is within tolerance of the
   *  manifest size. False for missing or partial files. */
  present: boolean
  /** Actual on-disk size in bytes (null when missing). */
  actualSizeBytes: number | null
}

export interface ModelsStatus {
  /** Where freshly-downloaded files land. Renderer surfaces this in
   *  troubleshooting/dev banners; not needed for the happy path. */
  downloadDir: string
  models: ModelAvailability[]
  /** Convenience: true when every `required: true` entry is `present: true`. */
  allRequiredReady: boolean
}

// ---------------------------------------------------------------------------

export type ModelState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export type LlmProfileName = 'lite' | 'full' | 'xl'
export type LlmProfileChoice = 'auto' | LlmProfileName

export interface ModelStatus {
  state: ModelState
  modelPath: string | null
  modelName: string | null
  gpu: string | null
  loadProgress: number | null // 0..1 during loading, null otherwise
  message: string | null
  profile: LlmProfileName | null
  /** Which provider source produced this status — drives the chat header pill. */
  source: 'bundled' | 'ollama'
  /** Active when the registry fell back from Ollama to bundled mid-request.
   *  `reason` is the underlying error message for surfacing in the UI; cleared
   *  naturally on the next clean status broadcast. */
  fallback: { active: boolean; reason: string | null }
}

export interface AvailableProfile {
  name: LlmProfileName
  displayName: string
  filename: string | null // null if no GGUF on disk for this profile
  contextSize: number
  minTotalMemGB: number
}

export type LlmContextChoice = 'auto' | number

export interface SystemInfo extends ModelStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  totalMemGB: number
  recommendedProfile: LlmProfileName
  selectedProfile: LlmProfileChoice
  profiles: AvailableProfile[]
  /** What the planner saw at the most recent autoLoad/loadModel call.
   *  Null until a load has happened. UI surfaces this so the user can see
   *  what auto-fit decided and why.
   *  (SystemResources is a main-process type; serialised to plain object over IPC.) */
  resources: unknown | null
  /** The last context-size plan, with its rationale.
   *  (LlmPlan is a main-process type; serialised to plain object over IPC.) */
  lastLlmPlan: unknown | null
  /** Currently active context-size choice — 'auto' or a pinned number. */
  selectedContext: LlmContextChoice
}

export type RefusalReason = 'no_hits' | 'below_threshold'

/** Pipeline stages emitted as `stage` events so the renderer can show real-time
 *  progress before the first token arrives. Order is roughly the chronological
 *  order each stage runs in QAService / RetrievalService.
 *    - route          : routing decision — only emitted when a non-default route
 *                       fires (same "no no-op rows" convention as expand/rerank)
 *    - contextualize  : LLM rewrites a follow-up into a standalone retrieval query
 *    - expand_queries : multiQuery — LLM paraphrases the query for recall
 *    - retrieve       : BM25 + dense fusion (always runs)
 *    - rerank         : cross-encoder pass over the candidate pool
 *    - summarize      : whole-doc summary fetch/generation (doc_summary route)
 *    - corpus         : documents-table count/list lookup (corpus route, no LLM)
 *    - prefill        : time between citations sent and first generated token
 */
export type StageName =
  | 'route'
  | 'contextualize'
  | 'expand_queries'
  | 'retrieve'
  | 'rerank'
  | 'summarize'
  | 'corpus'
  | 'prefill'

export type StreamEvent =
  | {
      type: 'token'
      text: string
      /** Number of native llama.cpp chunks this batch coalesces. Absent or 1
       *  for non-batched / synthesized text. Renderer adds this to its
       *  tokens/sec counter instead of incrementing by 1 per event. */
      count?: number
    }
  | { type: 'citation'; doc_id: number; chunk_id: number; score: number }
  | {
      type: 'stage'
      stage: StageName
      status: 'start' | 'done'
      /** Set on `done` events. Milliseconds spent in the stage. */
      durationMs?: number
      /** Optional short note for the renderer (e.g. "3 variants", "12 candidates"). */
      detail?: string
    }
  | {
      type: 'refusal'
      reason: RefusalReason
      message: string
      suggestions: Array<{ doc_id: number; title: string; score: number }>
    }
  | { type: 'error'; message: string }
  | {
      type: 'done'
      full_text: string
      citations: Array<{ doc_id: number; chunk_id: number; score: number }>
    }

export interface AnswerOptions {
  topK?: number
  refusalThreshold?: number
  language?: 'de' | 'en'
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  rerank?: boolean
  multiQuery?: boolean
  activeDocumentIds?: number[] | null
  /** Rewrite the new question into a standalone retrieval query using the
   *  prior turns in `history` before running retrieval. Fixes follow-ups
   *  like "gibt noch was dazu?" that have no topical keywords and would
   *  otherwise return zero relevant chunks. No-op when history is empty or
   *  the LLM is not loaded. */
  contextualize?: boolean
  /** Query routing (doc_summary / corpus / retrieval). Defaults to ON for the
   *  chat path; evals and tests pin `routing: false` to get the plain chunk
   *  pipeline regardless of query phrasing — the same escape hatch contract
   *  as pinning opts.topK against adaptiveTopK. */
  routing?: boolean
  /** When set, the chat:stream handler persists the user message before
   *  streaming, then persists the assistant message + citations on `done`
   *  (or on `refusal`, with citations=[]). Errors are not persisted. */
  conversationId?: number
}

export interface AnswerResult {
  answer: string
  citations: Array<{ doc_id: number; chunk_id: number; score: number }>
  refused: boolean
}

export interface RetrievalOptions {
  multiQuery?: boolean
  rerank?: boolean
  documentDiversity?: boolean
  wholeDocFallback?: boolean
  wholeDocThreshold?: number
  neighbourRadius?: number
  activeDocumentIds?: number[] | null
  perDocCandidateCap?: number
  titleBoostFactor?: number
  shortChunkPenalty?: number
  shortChunkMinChars?: number
  recencyBoostFactor?: number
  recencyBoostWindowMs?: number
}

// Conversation / message / citation shapes mirror src/main/db/schema.ts but
// live in src/shared so the renderer can import them safely.
export interface Conversation {
  id: number
  workspaceId: number
  title: string | null
  activeDocumentIds: number[]
  createdAt: number
  lastActivityAt: number
  messageCount: number
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: number
  conversationId: number
  role: MessageRole
  content: string
  createdAt: number
  /** Stream metrics captured at persistence time for assistant turns; null on
   *  user/system rows and on legacy/refusal assistant rows that never streamed. */
  ttftMs: number | null
  tokensPerSec: number | null
  tokenCount: number | null
}

export interface Citation {
  id: number
  messageId: number
  chunkId: number
  documentId: number
  score: number | null
  spanStart: number | null
  spanEnd: number | null
  createdAt: number
}

export interface ConversationWithMessages {
  conversation: Conversation
  messages: Array<Message & { citations: Citation[] }>
}

export interface ChunkWithContext {
  id: number
  documentId: number
  ordinal: number
  text: string
  tokenCount: number | null
  pageFrom: number | null
  pageTo: number | null
  isTarget: boolean
}

/** All chunks of a document, ordered by ordinal. Used by SourceViewer to render
 *  the whole document and focus the cited chunk. */
export interface DocumentChunk {
  id: number
  documentId: number
  ordinal: number
  text: string
  tokenCount: number | null
  pageFrom: number | null
  pageTo: number | null
  headingPath: string[] | null
  /** Per-chunk detected language (mig 0007 / eld). DocumentPreview renders
   *  it as a small tag on each section so the user can see which parts of a
   *  mixed-language document are in which language. */
  language: 'de' | 'en' | 'other' | null
}

/** Renderer-visible source-document metadata for a single chunk. The renderer
 *  uses this to decide whether to render a PDF page preview, markdown, or
 *  plain monospace text in the SourceViewer. Holds chunk-specific fields too
 *  (headingPath, chunkPage*) so the SourceViewer can render the cited chunk
 *  without a second IPC. */
export interface ChunkSource {
  documentId: number
  title: string
  mimeType: string | null
  /** Absolute path on disk — only displayed, never used to load bytes
   *  (renderer must go through documents.readDocumentBytes for that). */
  sourcePath: string
  /** Heading breadcrumb for the specific chunk this was fetched for. Null for
   *  PDFs and chunks indexed before markdown-aware chunking landed. */
  headingPath: string[] | null
  /** Page range of the cited chunk. PDFs use this to open the preview at the
   *  right page without fetching the full chunks list. Null for non-paginated
   *  documents (markdown, plain text). */
  chunkPageFrom: number | null
  chunkPageTo: number | null
}
