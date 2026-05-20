import type { RetrievalHit, ModelStatus } from '../../../../shared/documents'
import type { AskOptions } from '../../llm/LlamaService'
import type { LlmProvider, ProviderStatus } from '../types'
import { buildPrompt, buildSystemPrompt, type ResponseLanguage } from '../../llm/prompt'
import type { OllamaClient } from './OllamaClient'

interface ChatChunk {
  message?: { content?: string }
  done?: boolean
  error?: string
}

export class OllamaLlmProvider implements LlmProvider {
  private language: ResponseLanguage = 'de'

  constructor(
    private readonly client: OllamaClient,
    private readonly model: string,
  ) {}

  setLanguage(lang: ResponseLanguage): void {
    this.language = lang
  }

  async ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: buildSystemPrompt(this.language) },
    ]
    for (const h of opts.conversationHistory ?? []) {
      messages.push({ role: h.role, content: h.content })
    }
    messages.push({ role: 'user', content: buildPrompt(question, hits, []) })

    let acc = ''
    for await (const chunk of this.client.postNdjson<ChatChunk>(
      '/api/chat',
      { model: this.model, messages, stream: true },
      opts.abortSignal,
    )) {
      if (chunk.error) throw new Error(chunk.error)
      const piece = chunk.message?.content ?? ''
      if (piece) {
        acc += piece
        opts.onChunk?.(piece)
      }
      if (chunk.done) break
    }
    return acc
  }

  async generateRaw(prompt: string, opts: { abortSignal?: AbortSignal }): Promise<string> {
    let acc = ''
    for await (const chunk of this.client.postNdjson<{ response?: string; done?: boolean }>(
      '/api/generate',
      { model: this.model, prompt, stream: true },
      opts.abortSignal,
    )) {
      if (chunk.response) acc += chunk.response
      if (chunk.done) break
    }
    return acc.trim()
  }

  async generateTitle(
    user: string,
    assistant: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null> {
    const langWord = this.language === 'de' ? 'Deutsch' : 'English'
    const prompt =
      `Erstelle einen kurzen, prägnanten Titel (3 bis 6 Wörter) für dieses Gespräch in ${langWord}.\n` +
      `Antworte nur mit dem Titel selbst — keine Anführungszeichen, kein Punkt am Ende.\n\n` +
      `Benutzer: ${user.slice(0, 1200)}\n\n` +
      `Assistent: ${assistant.slice(0, 1200)}\n\n` +
      `Titel:`
    try {
      const rawOpts: { abortSignal?: AbortSignal } = {}
      if (opts?.abortSignal) rawOpts.abortSignal = opts.abortSignal
      const out = await this.generateRaw(prompt, rawOpts)
      const first = out
        .split(/\r?\n/)
        .find((l) => l.trim().length > 0)
        ?.trim()
      return first && first.length > 0 ? first.slice(0, 64) : null
    } catch {
      return null
    }
  }

  isReady(): boolean {
    return true // optimistic; probe runs at switch time
  }

  getStatus(): ProviderStatus {
    return { ready: true, message: null, identity: `ollama:${this.model}` }
  }

  getModelStatus(): ModelStatus {
    return {
      state: 'ready',
      modelPath: null,
      modelName: this.model,
      gpu: null,
      loadProgress: null,
      message: null,
      profile: null,
    }
  }
}
