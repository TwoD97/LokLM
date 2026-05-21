// LlmBridge — loads an LLM GGUF directly via node-llama-cpp and exposes a
// timed ask(). Bypasses the production LlamaService (now worker-only) so
// the eval keeps running under tsx.
//
// Reuses the production prompt builders from src/main/services/llm/prompt.ts
// since those are pure functions with no service deps — that way the eval
// measures the same prompt shape the app actually sends.
//
// What it measures:
//   - promptToFirstToken (ms) , from session.prompt() call to first onTextChunk.
//     This is the LLM-side TTFT — prefill + first-decode, can't be split with
//     the node-llama-cpp public surface.
//   - fullResponse (ms) , total time until prompt() resolves.
//   - chunkCount + charCount , approximate tokens/sec sanity check.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildPrompt,
  buildSystemPrompt,
  stripThink,
  type ResponseLanguage,
} from '../../../src/main/services/llm/prompt'
import type { RetrievalHit } from '../../../src/main/services/retrieval/RetrievalService'

export type Placement = 'cpu' | 'gpu' | 'auto'

export interface LlmBridgeOpts {
  /** absolute GGUF path. Overrides `profile` selection. */
  modelPath?: string
  /** discover-by-pattern: 'lite' (Qwen3-4B), 'full' (Qwen3-8B), 'xl'
   *  (Nemotron 3 Nano 30B-A3B). Used when `modelPath` is absent. */
  profile?: 'lite' | 'full' | 'xl' | 'auto'
  /** context window cap. Default 8192 — small enough to load quickly, big
   *  enough for retrieved chunks + prompt + answer. Override per config when
   *  measuring context-window axes. */
  contextSize?: number
  /** llama backend placement. 'auto' = let node-llama-cpp pick (uses GPU
   *  when available). */
  placement?: Placement
  language?: ResponseLanguage
  /** label baked into `name` / shown in reports. */
  label?: string
}

export interface LlmRunResult {
  /** assistant text after stripping <think> blocks. */
  text: string
  promptToFirstTokenMs: number
  fullResponseMs: number
  chunkCount: number
  charCount: number
}

const REPO_MODELS_DIR = join(process.cwd(), 'models')

// Same filename patterns as src/main/services/llm/LlamaService.ts LLM_PROFILES.
// Kept local so the bridge doesn't pull in LlamaService (which transitively
// pulls in the worker client).
const PROFILE_PATTERNS: Record<'lite' | 'full' | 'xl', RegExp[]> = {
  lite: [/qwen3.*[-_]?4b/i, /qwen2\.5.*[-_]?3b/i, /llama.*3\.2.*[-_]?3b/i],
  full: [/qwen3.*[-_]?8b/i, /qwen2\.5.*[-_]?7b/i],
  xl: [
    /nemotron.*3.*nano.*30b/i,
    /nemotron.*nano.*30b/i,
    /qwen3.*[-_]?30b.*a3b/i,
    /qwen3.*[-_]?32b/i,
    /qwen2\.5.*[-_]?32b/i,
    /nemotron.*super.*49b/i,
    /llama.*3\.3.*70b/i,
  ],
}

export class LlmBridge {
  readonly label: string
  private model: unknown = null
  private context: unknown = null
  private session: unknown = null
  private warmed = false
  private readonly profile: 'lite' | 'full' | 'xl' | 'auto'
  private readonly contextSize: number
  private readonly placement: Placement
  private readonly language: ResponseLanguage

  constructor(private readonly opts: LlmBridgeOpts = {}) {
    this.profile = opts.profile ?? 'auto'
    this.contextSize = opts.contextSize ?? 8192
    this.placement = opts.placement ?? 'auto'
    this.language = opts.language ?? 'de'
    this.label = opts.label ?? `llm:${this.profile}:ctx${this.contextSize}:${this.placement}`
  }

  async warm(): Promise<void> {
    if (this.warmed) return
    // Env-override-prioritätsfolge:
    //   1. opts.modelPath (caller hat EXPLIZIT einen pfad gesetzt → respektieren ;
    //      blockiert env-override damit der judge mit fest gepinnter Nemotron-
    //      pfad nicht versehentlich das under-test-modell lädt)
    //   2. LOKLM_LLM_PATH env (CLI-driven sweep across models — übertrumpft
    //      auch ein profil-arg vom caller weil das der ganze sinn der env-var
    //      ist: aus konfigs.ts ohne edit verschiedene modelle laufen lassen)
    //   3. resolveLlmPath(this.profile) (auto-discover via profile-patterns)
    const envPath = process.env.LOKLM_LLM_PATH
    let modelPath: string | null
    if (this.opts.modelPath) {
      modelPath = this.opts.modelPath
    } else if (envPath && existsSync(envPath)) {
      modelPath = envPath
    } else {
      modelPath = resolveLlmPath(this.profile)
    }
    if (!modelPath) {
      throw new Error(`llm bridge: no GGUF found in ${REPO_MODELS_DIR} for profile=${this.profile}`)
    }
     
    console.error(`[llm-bridge] loading ${modelPath}`)
    const lib = await import('node-llama-cpp')
    const gpu = this.placement === 'cpu' ? false : 'auto'
    const llama = await lib.getLlama({ gpu })
    this.model = await llama.loadModel({ modelPath })
    // contextSize MUST be passed as a {min, max} shape (not a bare number).
    // node-llama-cpp v3 with a bare number silently allocates KV-cache space
    // for the model's *native* max context (131k for Qwen3-8B → ~16 GB RSS +
    // ~5 GB weights = ~21 GB total). With the {min, max} range plus q8_0 KV
    // quantization, the library actually sizes the KV cache to a value in
    // the requested range and the allocation drops to a few hundred MB.
    // experimentalKvCacheKeyType / experimentalKvCacheValueType are the
    // same flags LlamaService uses in production; Q8_0 halves KV size with
    // negligible quality loss.
    this.context = await (
      this.model as {
        createContext: (o: Record<string, unknown>) => Promise<{ getSequence: () => unknown }>
      }
    ).createContext({
      contextSize: { min: Math.min(4096, this.contextSize), max: this.contextSize },
      flashAttention: true,
      experimentalKvCacheKeyType: 'Q8_0',
      experimentalKvCacheValueType: 'Q8_0',
    })
    this.session = new lib.LlamaChatSession({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contextSequence: (this.context as { getSequence: () => unknown }).getSequence() as any,
      systemPrompt: buildSystemPrompt(this.language),
    })
    this.warmed = true
  }

  /** Run one ask. Resets chat history per call (mirrors production behavior
   *  for stateless RAG turns) — prior turns are baked into the prompt body
   *  via conversationHistory, not session-internal accumulation. */
  async ask(
    question: string,
    hits: RetrievalHit[],
    opts: {
      abortSignal?: AbortSignal
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
    } = {},
  ): Promise<LlmRunResult> {
    await this.warm()
    const session = this.session as {
      prompt: (
        t: string,
        o: { onTextChunk?: (s: string) => void; signal?: AbortSignal; maxTokens?: number },
      ) => Promise<string>
      resetChatHistory?: () => void
    }
    try {
      session.resetChatHistory?.()
    } catch {
      /* ignore */
    }
    const prompt = buildPrompt(question, hits, opts.conversationHistory)
    let firstChunkAt: number | null = null
    let chunkCount = 0
    let chars = 0
    const start = performance.now()
    const promptOpts: {
      onTextChunk?: (s: string) => void
      signal?: AbortSignal
      maxTokens?: number
    } = {
      maxTokens: Math.max(1024, Math.min(8192, Math.floor(this.contextSize / 4))),
      onTextChunk: (chunk: string) => {
        if (firstChunkAt === null) firstChunkAt = performance.now()
        chunkCount++
        chars += chunk.length
      },
    }
    if (opts.abortSignal) promptOpts.signal = opts.abortSignal
    const raw = await session.prompt(prompt, promptOpts)
    const done = performance.now()
    return {
      text: stripThink(raw),
      promptToFirstTokenMs: firstChunkAt !== null ? firstChunkAt - start : done - start,
      fullResponseMs: done - start,
      chunkCount,
      charCount: chars,
    }
  }

  /** One-shot generation for the judge path. Does NOT preserve chat history
   *  before/after (judge owns its own session, history doesn't matter). */
  async generateRaw(prompt: string, opts: { abortSignal?: AbortSignal } = {}): Promise<string> {
    await this.warm()
    const session = this.session as {
      prompt: (t: string, o: { signal?: AbortSignal }) => Promise<string>
      resetChatHistory?: () => void
    }
    try {
      session.resetChatHistory?.()
    } catch {
      /* ignore */
    }
    const rawOpts: { signal?: AbortSignal } = {}
    if (opts.abortSignal) rawOpts.signal = opts.abortSignal
    const raw = await session.prompt(prompt, rawOpts)
    return stripThink(raw).trim()
  }

  async unload(): Promise<void> {
    try {
      if (this.session && hasDispose(this.session)) await this.session.dispose()
      if (this.context && hasDispose(this.context)) await this.context.dispose()
      if (this.model && hasDispose(this.model)) await this.model.dispose()
    } catch {
      /* best-effort */
    }
    this.session = null
    this.context = null
    this.model = null
    this.warmed = false
  }

  /** Probe used by ResourceSampler when wired. Returns null when no GPU. */
  vramProbe(): (() => Promise<number | null>) | null {
    if (!this.warmed) return null
    return async () => {
      try {
        const lib = await import('node-llama-cpp')
        const llama = await lib.getLlama({ gpu: 'auto' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = await (llama as any).getVramState?.()
        if (!v || typeof v.free !== 'number') return null
        return v.free / 1024 ** 3
      } catch {
        return null
      }
    }
  }
}

export { evalChunksToHits } from './hits'

/** Find an LLM GGUF in repo-local models/ by profile. */
export function resolveLlmPath(profile: 'lite' | 'full' | 'xl' | 'auto'): string | null {
  if (!existsSync(REPO_MODELS_DIR)) return null
  let entries: string[] = []
  try {
    entries = readdirSync(REPO_MODELS_DIR).filter((f: string) => f.toLowerCase().endsWith('.gguf'))
  } catch {
    return null
  }
  const order: Array<'lite' | 'full' | 'xl'> =
    profile === 'auto' ? ['xl', 'full', 'lite'] : [profile]
  for (const p of order) {
    const match = entries.find((f) => PROFILE_PATTERNS[p].some((re) => re.test(f)))
    if (match) return join(REPO_MODELS_DIR, match)
  }
  // No profile match — try any GGUF that doesn't look like embedder/reranker.
  const fallback = entries.find((f) => !/embed|reranker|bge/i.test(f))
  return fallback ? join(REPO_MODELS_DIR, fallback) : null
}

function hasDispose(o: unknown): o is { dispose: () => Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}
