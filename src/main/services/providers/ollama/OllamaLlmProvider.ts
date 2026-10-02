import type { RetrievalHit, ModelStatus } from '../../../../shared/documents'
import type { AskOptions } from '../../llm/LlamaService'
import type { LlmProvider, ProviderStatus } from '../types'
import {
  buildPrompt,
  buildSystemPrompt,
  bumpDepthForCode,
  answerMaxTokens,
  DEFAULT_CONTEXT_TOKENS,
  type ResponseLanguage,
} from '../../llm/prompt'
import { OllamaError, type OllamaClient } from './OllamaClient'
import {
  CitationAliasOutput,
  citationAliasesEnabled,
  createCitationAliases,
} from '../../llm/citationAliases'

interface ChatChunk {
  message?: { content?: string }
  done?: boolean
  error?: string
}

export class OllamaLlmProvider implements LlmProvider {
  private language: ResponseLanguage = 'de'
  private codebaseMode = false

  constructor(
    private readonly client: OllamaClient,
    private readonly model: string,
  ) {}

  async setLanguage(lang: ResponseLanguage): Promise<void> {
    // No worker round-trip — the system prompt is rebuilt per ask() from
    // this.language , so setting the field is enough.
    this.language = lang
  }

  async setCodebaseMode(on: boolean): Promise<void> {
    // Same shape as setLanguage: consumed by the per-ask() prompt build.
    this.codebaseMode = on
  }

  async ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string> {
    opts.abortSignal?.throwIfAborted()
    const aliases = citationAliasesEnabled()
      ? createCitationAliases(hits, opts.pinnedHits, [
          question,
          opts.contextPreamble ?? '',
          ...(opts.conversationHistory ?? []).map((message) => message.content),
        ])
      : null
    const citationOutput = new CitationAliasOutput(aliases, opts.onChunk)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: buildSystemPrompt(
          this.language,
          this.codebaseMode ? bumpDepthForCode('concise') : 'concise',
          { codebase: this.codebaseMode },
        ),
      },
    ]
    for (const h of opts.conversationHistory ?? []) {
      messages.push({ role: h.role, content: h.content })
    }
    messages.push({
      role: 'user',
      content: buildPrompt(
        question,
        hits,
        [],
        this.language,
        opts.pinnedHits,
        opts.contextPreamble,
        aliases,
      ),
    })

    let acc = ''
    let completed = false
    try {
      for await (const chunk of this.client.postNdjson<ChatChunk>(
        '/api/chat',
        {
          model: this.model,
          messages,
          stream: true,
          options: {
            num_ctx: this.contextWindowTokens(),
            num_predict: Math.max(
              1,
              Math.min(
                answerMaxTokens(this.contextWindowTokens()),
                Number.isFinite(opts.maxTokens)
                  ? Math.floor(opts.maxTokens!)
                  : answerMaxTokens(this.contextWindowTokens()),
              ),
            ),
          },
        },
        opts.abortSignal,
      )) {
        opts.abortSignal?.throwIfAborted()
        if (chunk.error) throw new OllamaError('server', chunk.error)
        const piece = chunk.message?.content ?? ''
        if (piece) {
          acc += piece
          // Ollama's NDJSON stream is one chunk per token-ish; pass count=1.
          // (Native worker batches its own chunks; the count plumbing is the
          // same shape across providers.)
          citationOutput.feed(piece, 1)
        }
        if (chunk.done) {
          completed = true
          break
        }
      }
      opts.abortSignal?.throwIfAborted()
      if (!completed) throw new OllamaError('server', 'Ollama answer ended before completion.')
      return citationOutput.final(acc)
    } catch (error) {
      opts.abortSignal?.throwIfAborted()
      if (
        acc.length > 0 &&
        error instanceof OllamaError &&
        (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server')
      ) {
        // The registry may retry transient failures on the bundled model only
        // before any response text was produced. Once a partial answer exists,
        // fail this turn so its existing text is marked incomplete, not joined
        // to a second model's answer. A plain Error is deliberately non-retryable.
        throw new Error('Ollama stopped before completing the answer.', { cause: error })
      }
      throw error
    } finally {
      citationOutput.flush()
    }
  }

  async generateRaw(
    prompt: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      // Ollama accepts a JSON schema via format. Callers must still validate
      // source references and meaning: valid JSON does not establish truth.
      jsonSchema?: object | undefined
      // Only override the server/model default when explicitly requested.
      noThink?: boolean | undefined
      systemPrompt?: string | undefined
      temperature?: number | undefined
      requireComplete?: boolean | undefined
    },
  ): Promise<string> {
    opts.abortSignal?.throwIfAborted()
    let acc = ''
    let completed = false
    const body: Record<string, unknown> = { model: this.model, prompt, stream: true }
    if (opts.systemPrompt != null) body.system = opts.systemPrompt
    if (opts.jsonSchema != null) body.format = opts.jsonSchema
    if (opts.noThink != null) body.think = !opts.noThink
    body.options = {
      num_ctx: this.contextWindowTokens(),
      ...(opts.maxTokens != null ? { num_predict: opts.maxTokens } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    }
    try {
      for await (const chunk of this.client.postNdjson<{
        response?: string
        done?: boolean
        done_reason?: string
        error?: string
      }>('/api/generate', body, opts.abortSignal)) {
        opts.abortSignal?.throwIfAborted()
        if (chunk.error) throw new OllamaError('server', chunk.error)
        if (chunk.response) acc += chunk.response
        if (chunk.done) {
          completed = true
          if (opts.requireComplete && chunk.done_reason === 'length') {
            throw new Error(
              'Generation reached the model output limit. Please retry with shorter input.',
            )
          }
          break
        }
      }
    } catch (error) {
      opts.abortSignal?.throwIfAborted()
      if (
        error instanceof OllamaError &&
        error.kind === 'client' &&
        (error.status === 400 || error.status === 422) &&
        (opts.jsonSchema != null || opts.noThink != null)
      ) {
        // Do not quietly retry with weaker constraints or classify an
        // unsupported model option as a transient outage/bundled fallback.
        throw new OllamaError(
          'client',
          `${error.message}. Check whether the selected Ollama model and server support the requested JSON schema and thinking options.`,
          error.status,
        )
      }
      throw error
    }
    opts.abortSignal?.throwIfAborted()
    if (!completed) throw new OllamaError('server', 'Ollama generation ended before completion.')
    const result = acc.trim()
    if (!result && (opts.requireComplete || opts.jsonSchema != null))
      throw new OllamaError('server', 'Ollama generation returned no output.')
    return result
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

  contextWindowTokens(): number {
    // Explicitly request this same window on /api/chat so QA does not budget
    // for 8K while a server default silently gives the request less context.
    return DEFAULT_CONTEXT_TOKENS
  }

  isCpuInference(): boolean {
    // Assume the Ollama server is adequately resourced; we don't throttle it.
    return false
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
      source: 'ollama',
      fallback: { active: false, reason: null },
    }
  }
}
