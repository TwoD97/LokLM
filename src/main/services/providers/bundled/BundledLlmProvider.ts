import type { LlamaService, AskOptions } from '../../llm/LlamaService'
import type { ModelStatus, RetrievalHit } from '../../../../shared/documents'
import type { LlmProvider, ProviderStatus } from '../types'

/**
 * Thin adapter that exposes the LlamaService (bundled GGUF inference) behind
 * the LlmProvider contract. Used by the provider-selection layer so the QA
 * pipeline never depends on the concrete LlamaService class — it always
 * talks to an LlmProvider and the active provider gets swapped underneath.
 */
export class BundledLlmProvider implements LlmProvider {
  constructor(private readonly inner: LlamaService) {}

  ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string> {
    return this.inner.ask(question, hits, opts)
  }

  generateRaw(prompt: string, opts: { abortSignal?: AbortSignal }): Promise<string> {
    return this.inner.generateRaw(prompt, opts)
  }

  generateTitle(
    user: string,
    assistant: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null> {
    return this.inner.generateTitle(user, assistant, opts)
  }

  isReady(): boolean {
    return this.inner.isReady()
  }

  getStatus(): ProviderStatus {
    const s = this.inner.getStatus()
    return {
      ready: s.state === 'ready',
      message: s.message,
      identity: `bundled:${s.modelName ?? 'unknown'}`,
    }
  }

  getModelStatus(): ModelStatus {
    return this.inner.getStatus()
  }
}
