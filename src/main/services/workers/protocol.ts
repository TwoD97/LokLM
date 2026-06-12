// Wire protocol between main and the modelsWorker utilityProcess. All llama
// native bindings live in the worker , main only sees these JSON-safe shapes.
//
// Conventions:
//   - Every request carries a numeric `id`. The worker replies with exactly
//     one `Response<id>` (ok=true with result, or ok=false with error).
//   - Push events (no id) carry status updates, load progress, and token
//     stream chunks. They never block the request/response queue.

import type {
  ModelStatus,
  EmbedderStatus,
  RerankerStatus,
  LlmProfileName,
  LlmContextChoice,
} from '../../../shared/documents'
import type { LlmPlan, SystemResources, PlacementChoice } from '../embeddings/ResourcePlanner'

export type ServiceKind = 'llm' | 'embedder' | 'reranker'

// ---------------------------------------------------------------------------
// Requests , main → worker
// ---------------------------------------------------------------------------

export type WorkerRequest =
  | { id: number; op: 'llm.load'; payload: LlmLoadPayload }
  | { id: number; op: 'llm.unload' }
  | {
      id: number
      op: 'llm.setLanguage'
      payload: { lang: 'de' | 'en'; systemPrompt: string }
    }
  | { id: number; op: 'llm.ask'; payload: LlmAskPayload }
  | { id: number; op: 'llm.generateRaw'; payload: LlmGenerateRawPayload }
  | { id: number; op: 'llm.abort'; payload: { streamId: string } }
  | { id: number; op: 'embedder.load'; payload: EmbedderLoadPayload }
  | { id: number; op: 'embedder.unload' }
  | { id: number; op: 'embedder.embed'; payload: { texts: string[] } }
  | { id: number; op: 'reranker.load'; payload: RerankerLoadPayload }
  | { id: number; op: 'reranker.unload' }
  | { id: number; op: 'reranker.rank'; payload: { query: string; documents: string[] } }
  | { id: number; op: 'planner.refresh' }
  | { id: number; op: 'shutdown' }

export interface LlmLoadPayload {
  modelPath: string
  profileName: LlmProfileName | null
  profileDefaultContext: number
  weightsBytes: number
  userContextChoice: LlmContextChoice
  language: 'de' | 'en'
  envContextOverride: number | null
  // Full system prompt built on the main side from src/main/services/llm/prompt.ts.
  // Shipped across the wire so the worker stays free of document-type imports
  // while the citation directive (and refusal text, /no_think, tool list) remain
  // the single source of truth in prompt.ts.
  systemPrompt: string
}

export interface LlmAskPayload {
  streamId: string
  question: string
  // We pass the fully-built prompt body so the worker doesn't need to import
  // the prompt-builder module. Same with system prompt + max tokens.
  prompt: string
  maxTokens: number
  // Enforce the system prompt's /no_think via node-llama-cpp's segment budget
  // (budgets.thoughtTokens = 0) — the tag alone is unreliable for this GGUF.
  noThink?: boolean
}

export interface LlmGenerateRawPayload {
  streamId: string
  prompt: string
  /** Optional ceiling so callers on the TTFT critical path (contextualize,
   *  multi-query expansion) don't get a full-answer-sized generation when
   *  the model ignores its single-line instructions. */
  maxTokens?: number
  /** Optional node-llama-cpp GbnfJsonSchema. The worker builds (and caches) a
   *  grammar from it and constrains generation to valid JSON. On any grammar
   *  build failure the worker logs a warn and generates without it. */
  jsonSchema?: object
  /** Disable the model's reasoning segment (budgets.thoughtTokens = 0). Used by
   *  structured/utility generations (quiz) where thinking only adds latency. */
  noThink?: boolean
}

export interface EmbedderLoadPayload {
  modelPath: string
  placement: PlacementChoice
  weightsBytes: number
  contextSize: number
}

export interface RerankerLoadPayload {
  modelPath: string
  placement: PlacementChoice
  weightsBytes: number
  contextSize: number
}

// ---------------------------------------------------------------------------
// Responses , worker → main (paired by id)
// ---------------------------------------------------------------------------

export type WorkerResponse<T = unknown> =
  | { id: number; ok: true; result: T }
  | { id: number; ok: false; error: string }

export interface LlmLoadResult {
  plan: LlmPlan
  resources: SystemResources
  gpuLabel: string | null
}

export interface EmbedderLoadResult {
  resources: SystemResources
  resolvedPlacement: 'cpu' | 'gpu'
  reason: string
}

export interface RerankerLoadResult {
  resources: SystemResources
  resolvedPlacement: 'cpu' | 'gpu'
  reason: string
}

// ---------------------------------------------------------------------------
// Push events , worker → main (no id, fire-and-forget)
// ---------------------------------------------------------------------------

export type WorkerPush =
  | { ev: 'status'; service: 'llm'; status: Partial<ModelStatus> }
  | { ev: 'status'; service: 'embedder'; status: Partial<EmbedderStatus> }
  | { ev: 'status'; service: 'reranker'; status: Partial<RerankerStatus> }
  | {
      ev: 'token'
      streamId: string
      text: string
      /** Number of native onTextChunk callbacks coalesced into this push. The
       *  worker buffers chunks for ~8 ms and ships them in one message; the
       *  renderer uses `count` to keep its tokens/sec metric accurate. Absent
       *  for the first push (and any single-chunk push) , treat as 1. */
      count?: number
    }
  | { ev: 'log'; level: 'info' | 'warn' | 'error'; message: string }

export type WorkerMessage = WorkerResponse | WorkerPush
