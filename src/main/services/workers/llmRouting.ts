// Routing for raw utility generations (contextualize, expand-queries, title
// gen, small quiz calls). These used to run on the main chat sequence, which
// erased the sequence's KV state between asks — exactly the [system][pinned]
// [history] prefix that makes per-turn chat prefill cheap. A small dedicated
// utility context absorbs them instead; anything too big for it falls back to
// the main session (the status quo before this module existed).
//
// Pure functions in their own module because modelsWorker.ts runs inside an
// Electron utilityProcess and isn't importable under vitest.

/** Per-sequence size of the dedicated utility context. Small on purpose: the
 *  utility generations are sub-1K-token prompts with sub-1K outputs, and KV
 *  memory for this context is paid on top of the main context's. Anything
 *  bigger (large quiz prompts pack toward the MAIN window) falls back. */
export const UTILITY_CONTEXT_MAX_TOKENS = 4096

/** Output reserve assumed when the caller didn't set maxTokens — keeps an
 *  unbounded generation from context-shifting the prompt out of the small
 *  utility window. */
export const UTILITY_GEN_DEFAULT_RESERVE = 1024

/** Framing slack: chat-template tokens (system/user wrappers) around the raw
 *  prompt plus the system prompt itself are not counted by the caller's
 *  prompt-token estimate. */
const FRAMING_SLACK_TOKENS = 768

/** True when a raw generation fits the utility context: prompt tokens plus
 *  the (requested or assumed) output budget plus framing slack stay inside
 *  the utility window. */
export function fitsUtilityContext(
  promptTokens: number,
  maxTokens: number | undefined,
  utilityContextSize: number,
): boolean {
  const reserve = maxTokens ?? UTILITY_GEN_DEFAULT_RESERVE
  return promptTokens + reserve + FRAMING_SLACK_TOKENS <= utilityContextSize
}
