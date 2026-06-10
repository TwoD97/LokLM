import { describe, it, expect } from 'vitest'
import { shouldUnloadOnConversationSwitch } from '@main/services/llm/conversationSwitch'

// AP-9 §3.8 "Konv.-Wechsel": unload | keep (default keep). When the user
// switches conversations and the mode is "unload", the LLM is freed eagerly
// (instead of waiting for LlamaService's idle timer). The one hard constraint:
// never unload while a generation is streaming, or we'd kill the in-flight
// answer. "keep" never unloads.
describe('shouldUnloadOnConversationSwitch', () => {
  it('unloads on switch when mode is "unload" and nothing is streaming', () => {
    expect(shouldUnloadOnConversationSwitch('unload', false)).toBe(true)
  })

  it('never unloads mid-stream — an in-flight generation must not be killed', () => {
    expect(shouldUnloadOnConversationSwitch('unload', true)).toBe(false)
  })

  it('keeps the model loaded when mode is "keep"', () => {
    expect(shouldUnloadOnConversationSwitch('keep', false)).toBe(false)
    expect(shouldUnloadOnConversationSwitch('keep', true)).toBe(false)
  })
})
