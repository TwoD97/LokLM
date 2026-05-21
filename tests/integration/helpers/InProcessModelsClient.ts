// In-process stand-in for ModelsWorkerClient — used by the integration tests
// only. Production loads the same models inside a utilityProcess worker
// (src/main/services/workers/modelsWorker.ts), but `utilityProcess` is an
// Electron-only API so the worker can't run under a plain vitest node env.
// This helper duck-types the small subset of the worker's wire protocol that
// LlamaService + EmbeddingService actually call: load, unload, embed, ask /
// generateRaw, abort, setLanguage, plus status + token push callbacks.
//
// Scope is intentionally narrow:
//   - One backend per placement (CPU default; the tests don't toggle it)
//   - No KV-quant fallback cascade (the worker has one — tests just pick what
//     fits their model size on dev hardware)
//   - No planner.refresh / VRAM probing — fills a dummy SystemResources shape
//   - Status pushes only fire {state:'ready'} on success and {state:'failed'}
//     on errors. EmbeddingService / LlamaService use isReady() === ready and
//     don't care about intermediate "loading" messages in the assertions.

import type {
  EmbedderLoadPayload,
  EmbedderLoadResult,
  LlmAskPayload,
  LlmGenerateRawPayload,
  LlmLoadPayload,
  LlmLoadResult,
  RerankerLoadPayload,
  RerankerLoadResult,
  ServiceKind,
} from '@main/services/workers/protocol'
import type { EmbedderStatus, ModelStatus, RerankerStatus } from '../../../src/shared/documents'
import type { SystemResources } from '@main/services/embeddings/ResourcePlanner'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'

type StatusListener = {
  llm: (s: Partial<ModelStatus>) => void
  embedder: (s: Partial<EmbedderStatus>) => void
  reranker: (s: Partial<RerankerStatus>) => void
}

// node-llama-cpp's session.prompt signature is loosely typed in the worker —
// mirror the same shape here so the test client doesn't need exact bindings.
type LlamaSession = {
  prompt: (
    text: string,
    options: {
      onTextChunk?: (s: string) => void
      signal?: AbortSignal
      maxTokens?: number
    },
  ) => Promise<string>
  resetChatHistory?: () => void
  getChatHistory?: () => unknown[]
  setChatHistory?: (h: unknown[]) => void
  dispose?: () => void | Promise<void>
}
type LlamaModel = { dispose?: () => Promise<void> }
type LlamaContext = { getSequence: () => unknown; dispose?: () => Promise<void> }
type EmbedderCtx = {
  getEmbeddingFor: (t: string) => Promise<{ vector: Float32Array | number[] }>
  dispose?: () => void | Promise<void>
}

const DUMMY_RESOURCES: SystemResources = {
  totalRamGB: 0,
  freeRamGB: 0,
  totalVramGB: 0,
  freeVramGB: 0,
  hasGpu: false,
  platform: process.platform,
  osHeadroomGB: 0,
  vramHeadroomGB: 0,
}

export class InProcessModelsClient {
  private statusListeners: StatusListener = {
    llm: () => undefined,
    embedder: () => undefined,
    reranker: () => undefined,
  }
  private tokenListeners = new Map<string, (text: string) => void>()
  private aborts = new Map<string, AbortController>()

  private llmModel: LlamaModel | null = null
  private llmContext: LlamaContext | null = null
  private llmSession: LlamaSession | null = null

  private embedderModel: LlamaModel | null = null
  private embedderContext: EmbedderCtx | null = null

  setStatusListener<K extends ServiceKind>(kind: K, cb: StatusListener[K]): void {
    this.statusListeners[kind] = cb as StatusListener[K]
  }

  registerStream(streamId: string, onToken: (text: string) => void): () => void {
    this.tokenListeners.set(streamId, onToken)
    return () => this.tokenListeners.delete(streamId)
  }

  // ---- LLM -----------------------------------------------------------------

  async llmLoad(payload: LlmLoadPayload): Promise<LlmLoadResult> {
    await this.llmUnloadInternal()
    this.statusListeners.llm({
      state: 'loading',
      modelPath: payload.modelPath,
      modelName: payload.modelPath.split(/[\\/]/).pop() ?? 'llm.gguf',
      loadProgress: 0,
      message: 'Loading…',
    })
    try {
      const lib = (await import('node-llama-cpp')) as unknown as {
        getLlama: (o: { gpu: false | 'auto' }) => Promise<{
          loadModel: (o: { modelPath: string }) => Promise<LlamaModel>
        }>
        LlamaChatSession: new (o: {
          contextSequence: unknown
          systemPrompt: string
        }) => LlamaSession
      }
      const llama = await lib.getLlama({ gpu: 'auto' })
      const model = await llama.loadModel({ modelPath: payload.modelPath })
      const context = await (
        model as unknown as {
          createContext: (o: Record<string, unknown>) => Promise<LlamaContext>
        }
      ).createContext({
        contextSize: { min: 4096, max: Math.min(8192, payload.profileDefaultContext) },
        flashAttention: true,
      })
      const session = new lib.LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: payload.systemPrompt,
      })
      this.llmModel = model
      this.llmContext = context
      this.llmSession = session
      this.statusListeners.llm({ state: 'ready', loadProgress: null, message: 'Ready.' })
      return {
        plan: {
          contextSize: 8192,
          fitsInVram: true,
          estimatedFreeVramGBAfterLoad: 0,
          kvCacheType: 'f16',
          reason: 'in-process test client',
        },
        resources: DUMMY_RESOURCES,
        gpuLabel: null,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.statusListeners.llm({ state: 'failed', loadProgress: null, message: msg })
      throw err
    }
  }

  async llmUnload(): Promise<void> {
    await this.llmUnloadInternal()
    this.statusListeners.llm({ state: 'unloaded', message: 'Model unloaded.' })
  }

  private async llmUnloadInternal(): Promise<void> {
    try {
      await this.llmSession?.dispose?.()
      await this.llmContext?.dispose?.()
      await this.llmModel?.dispose?.()
    } catch {
      /* best-effort */
    }
    this.llmSession = null
    this.llmContext = null
    this.llmModel = null
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async llmSetLanguage(_lang: 'de' | 'en', _systemPrompt: string): Promise<void> {
    // No-op: tests don't switch language mid-stream.
  }

  async llmAsk(payload: LlmAskPayload): Promise<{ raw: string }> {
    if (!this.llmSession) throw new Error('Model is not loaded.')
    try {
      this.llmSession.resetChatHistory?.()
    } catch {
      /* best-effort */
    }
    const ctrl = new AbortController()
    this.aborts.set(payload.streamId, ctrl)
    try {
      const raw = await this.llmSession.prompt(payload.prompt, {
        maxTokens: payload.maxTokens,
        signal: ctrl.signal,
        onTextChunk: (chunk) => this.tokenListeners.get(payload.streamId)?.(chunk),
      })
      return { raw }
    } finally {
      this.aborts.delete(payload.streamId)
    }
  }

  async llmGenerateRaw(payload: LlmGenerateRawPayload): Promise<{ raw: string }> {
    if (!this.llmSession) throw new Error('Model is not loaded.')
    const ctrl = new AbortController()
    this.aborts.set(payload.streamId, ctrl)
    let saved: unknown[] | undefined
    try {
      saved = this.llmSession.getChatHistory?.()
    } catch {
      saved = undefined
    }
    try {
      this.llmSession.resetChatHistory?.()
      const raw = await this.llmSession.prompt(payload.prompt, { signal: ctrl.signal })
      return { raw }
    } finally {
      if (saved) {
        try {
          this.llmSession.setChatHistory?.(saved)
        } catch {
          /* best-effort */
        }
      }
      this.aborts.delete(payload.streamId)
    }
  }

  async llmAbort(streamId: string): Promise<void> {
    const ctrl = this.aborts.get(streamId)
    if (ctrl) ctrl.abort()
  }

  // ---- Embedder ------------------------------------------------------------

  async embedderLoad(payload: EmbedderLoadPayload): Promise<EmbedderLoadResult> {
    await this.embedderUnloadInternal()
    this.statusListeners.embedder({
      state: 'loading',
      modelPath: payload.modelPath,
      modelName: payload.modelPath.split(/[\\/]/).pop() ?? 'embedder.gguf',
      loadProgress: 0,
      message: 'Loading…',
    })
    try {
      const lib = (await import('node-llama-cpp')) as unknown as {
        getLlama: (o: { gpu: false | 'auto' }) => Promise<{
          loadModel: (o: { modelPath: string }) => Promise<LlamaModel>
        }>
      }
      const llama = await lib.getLlama({ gpu: payload.placement === 'gpu' ? 'auto' : false })
      const model = await llama.loadModel({ modelPath: payload.modelPath })
      const context = await (
        model as unknown as {
          createEmbeddingContext: (o: { contextSize?: number }) => Promise<EmbedderCtx>
        }
      ).createEmbeddingContext({ contextSize: payload.contextSize })
      this.embedderModel = model
      this.embedderContext = context
      this.statusListeners.embedder({ state: 'ready', loadProgress: null, message: 'Ready.' })
      return {
        resources: DUMMY_RESOURCES,
        resolvedPlacement: payload.placement === 'gpu' ? 'gpu' : 'cpu',
        reason: 'in-process test client',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.statusListeners.embedder({ state: 'failed', loadProgress: null, message: msg })
      throw err
    }
  }

  async embedderUnload(): Promise<void> {
    await this.embedderUnloadInternal()
    this.statusListeners.embedder({ state: 'unloaded', message: 'Embedder unloaded.' })
  }

  private async embedderUnloadInternal(): Promise<void> {
    try {
      await this.embedderContext?.dispose?.()
      await this.embedderModel?.dispose?.()
    } catch {
      /* best-effort */
    }
    this.embedderContext = null
    this.embedderModel = null
  }

  async embedderEmbed(texts: string[]): Promise<Array<number[] | null>> {
    if (!this.embedderContext) throw new Error('Embedder is not loaded.')
    const out: Array<number[] | null> = []
    for (const t of texts) {
      if (t.length === 0) {
        out.push(null)
        continue
      }
      try {
        const r = await this.embedderContext.getEmbeddingFor(t)
        out.push(Array.from(r.vector))
      } catch {
        out.push(null)
      }
    }
    return out
  }

  // ---- Reranker (unused by these tests) ------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async rerankerLoad(_: RerankerLoadPayload): Promise<RerankerLoadResult> {
    throw new Error('InProcessModelsClient: reranker not implemented (tests stub it out).')
  }
  async rerankerUnload(): Promise<void> {
    /* no-op */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async rerankerRank(_: string, __: string[]): Promise<number[] | null> {
    return null
  }
}

/** Convenience cast — EmbeddingService / LlamaService accept the concrete
 *  ModelsWorkerClient class. Structurally the surface matches but TypeScript
 *  treats private fields nominally, so an explicit cast keeps the test sites
 *  short. */
export function asModelsWorkerClient(c: InProcessModelsClient): ModelsWorkerClient {
  return c as unknown as ModelsWorkerClient
}
