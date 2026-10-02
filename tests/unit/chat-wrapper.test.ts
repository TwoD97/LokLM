import { describe, expect, it } from 'vitest'
import { ChatMLChatWrapper, QwenChatWrapper } from 'node-llama-cpp'
import { nonThinkingChatWrapper } from '@main/services/workers/chatWrapper'

describe('public nonthinking Qwen 3.5 wrapper selection', () => {
  it('closes the thought prefix before the first generated text or JSON token', () => {
    const automatic = new QwenChatWrapper({ variation: '3.5', keepOnlyLastThought: false })
    expect(automatic.settings.segments?.thought?.openOnResponseStart).toBe(true)
    const selected = nonThinkingChatWrapper(automatic, QwenChatWrapper) as QwenChatWrapper
    expect(selected.variation).toBe('3.5')
    expect(selected.keepOnlyLastThought).toBe(false)
    expect(selected.thoughts).toBe('discourage')
    expect(selected.settings.segments?.thought?.openOnResponseStart).toBe(false)
    const context = selected
      .generateContextState({
        chatHistory: [
          { type: 'system', text: 'Return JSON.' },
          { type: 'user', text: 'A factual question.' },
          { type: 'model', response: [] },
        ],
      })
      .contextText.toString()
    expect(context).toMatch(/<\|im_start\|>assistant\n<think>\n\n<\/think>\n\n$/)
    // The original auto-resolved wrapper is never mutated.
    expect(automatic.thoughts).toBe('auto')
    expect(automatic.settings.segments?.thought?.openOnResponseStart).toBe(true)
  })

  it.each(['discourage', 'modelInitiated'] as const)(
    'preserves an explicit %s mode',
    (thoughts) => {
      const wrapper = new QwenChatWrapper({ variation: '3.5', thoughts })
      expect(nonThinkingChatWrapper(wrapper, QwenChatWrapper)).toBe(wrapper)
    },
  )

  it('preserves other model families and the older Qwen template', () => {
    for (const wrapper of [new ChatMLChatWrapper(), new QwenChatWrapper({ variation: '3' })])
      expect(nonThinkingChatWrapper(wrapper, QwenChatWrapper)).toBe(wrapper)
  })

  it('retains thought segment recognition for explicitly allowed model-initiated reasoning', () => {
    const automatic = new QwenChatWrapper({ variation: '3.5' })
    const selected = nonThinkingChatWrapper(automatic, QwenChatWrapper)
    expect(selected.settings.segments?.thought?.prefix).toEqual(
      automatic.settings.segments?.thought?.prefix,
    )
    expect(selected.settings.segments?.thought?.suffix).toEqual(
      automatic.settings.segments?.thought?.suffix,
    )
  })
})
