import type { ChatWrapper, QwenChatWrapper } from 'node-llama-cpp'

/** node-llama-cpp 3.21.1 checks a zero thought budget after accepting the first
 * generated token. Qwen 3.5's auto-opened thought segment can therefore consume
 * the first JSON brace or answer token. Use its public closed-thought template
 * instead; never reconstruct output or expose thought segments as answer text.
 * An explicit noThink:false call still permits model-initiated reasoning, but
 * does not force a thought segment before any output. */
export function nonThinkingChatWrapper(
  wrapper: ChatWrapper,
  QwenWrapper: typeof QwenChatWrapper,
): ChatWrapper {
  if (
    !(wrapper instanceof QwenWrapper) ||
    wrapper.variation !== '3.5' ||
    wrapper.thoughts !== 'auto'
  )
    return wrapper
  return new QwenWrapper({
    variation: wrapper.variation,
    keepOnlyLastThought: wrapper.keepOnlyLastThought,
    thoughts: 'discourage',
  })
}
