import type { ProviderRegistry } from '../providers/Registry'
import { estimateTokens, DEFAULT_CONTEXT_TOKENS } from '../llm/prompt'
import { detectResponseLanguage } from '../documents/languageDetector'
import type { WriteResult, WritingMode } from '../../../shared/writing'
import { buildWritePrompt, WRITE_MAX_TOKENS, WRITE_PROMPT_RESERVE_TOKENS } from './prompt'

export type WritingErrorCode = 'empty' | 'too_long' | 'model_not_ready' | 'failed'

export class WritingError extends Error {
  constructor(
    message: string,
    readonly code: WritingErrorCode,
  ) {
    super(message)
    this.name = 'WritingError'
  }
}

/**
 * The "Write" assistant — DeepL-Write-style rewriting on the bundled chat LLM.
 * Stateless and DB-free (unlike SummarizationService): it rewrites arbitrary
 * pasted text , so it only needs the provider registry's LLM. One-shot
 * generateRaw , same path summarization/quiz use; the worker serializes it
 * behind any in-flight chat generation.
 */
export class WritingService {
  constructor(private readonly registry: ProviderRegistry) {}

  async improve(
    text: string,
    mode: WritingMode,
    opts: { abortSignal?: AbortSignal } = {},
  ): Promise<WriteResult> {
    const trimmed = text.trim()
    if (trimmed.length === 0) throw new WritingError('Nothing to rewrite.', 'empty')

    const llm = this.registry.llm()
    if (!llm.isReady()) {
      throw new WritingError('The language model is not loaded yet.', 'model_not_ready')
    }

    const language = await detectResponseLanguage(trimmed.slice(0, 2000))

    // Budget: leave room for the rewrite (~input length , generous for the
    // expand mode) plus the instruction text inside the context window.
    const ctxTokens = llm.contextWindowTokens() || DEFAULT_CONTEXT_TOKENS
    const inTokens = estimateTokens(trimmed)
    const available = ctxTokens - WRITE_PROMPT_RESERVE_TOKENS - inTokens
    if (available < 128) {
      throw new WritingError('The text is too long for the model context.', 'too_long')
    }
    const maxTokens = Math.min(WRITE_MAX_TOKENS, Math.max(128, inTokens * 2 + 128), available)

    const prompt = buildWritePrompt(language, mode, trimmed)
    const raw = await llm.generateRaw(prompt, {
      maxTokens,
      // No reasoning segment — we want the rewrite , not the model thinking out
      // loud. generateRaw already strips <think> blocks; this skips them.
      noThink: true,
      ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
    })

    const out = cleanOutput(raw)
    if (out.length === 0) throw new WritingError('The model returned nothing.', 'failed')
    return { text: out, detected: language, mode }
  }
}

/** Trim the small-model residue generateRaw's stripThink+trim doesn't: a
 *  leading echoed label ("Rewritten text:") and a fully-wrapping pair of
 *  quotes. Conservative — only unwraps when the WHOLE output is quoted, so a
 *  rewrite that legitimately contains quotes is untouched. */
function cleanOutput(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^(rewritten text|umgeschriebener text)\s*:\s*/i, '').trim()
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    const pairs: Record<string, string> = { '"': '"', '“': '”', '„': '“', "'": "'" }
    if (first && pairs[first] === last && !s.slice(1, -1).includes(first)) {
      s = s.slice(1, -1).trim()
    }
  }
  return s
}
