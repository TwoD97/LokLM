/**
 * Decides whether the LLM should be unloaded when the user switches
 * conversations, per the AP-9 "Konv.-Wechsel" setting
 * (`runtime.conversationSwitch`).
 *
 * - `keep` (default): never unload — the model stays warm across switches.
 * - `unload`: free the model eagerly on switch, *unless* a generation is
 *   currently streaming. Unloading mid-stream would abort the in-flight answer,
 *   so an active stream always wins; LlamaService's idle timer will reclaim the
 *   model later if it stays unused.
 */
export function shouldUnloadOnConversationSwitch(
  mode: 'unload' | 'keep',
  hasActiveStream: boolean,
): boolean {
  return mode === 'unload' && !hasActiveStream
}
