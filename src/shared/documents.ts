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
}

export type EmbedderState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface EmbedderStatus {
  kind: 'embedder'
  state: EmbedderState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
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
  text: string
  score: number
  origin?: 'primary' | 'neighbour' | 'whole_doc'
}

// ---------------------------------------------------------------------------
// LLM / LlamaService shared types — renderer + preload + main must agree.
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

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'citation'; doc_id: number; chunk_id: number; score: number }
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
