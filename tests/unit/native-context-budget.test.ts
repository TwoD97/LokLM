import { describe, expect, it, vi } from 'vitest'
import {
  assertPreparedPromptFits,
  countPreparedPromptTokens,
  fitsFreshPromptContext,
  prepareChatPromptBudget,
} from '@main/services/workers/contextBudget'

function fixture(tokens = 500) {
  const history = [{ type: 'system', text: 'Actual selected system prompt' }]
  const tokenizer = vi.fn()
  const tokenize = vi.fn(() => Array.from({ length: tokens }, () => 1))
  const generate = vi.fn(() => ({ contextText: { tokenize } }))
  const session = {
    getChatHistory: () => history,
    chatWrapper: { generateContextState: generate },
    model: { tokenizer },
  }
  const options = {
    session: session as never,
    plannedContextTokens: 8192,
    actualContextTokens: 4096,
    prompt: 'Source text and question',
    maxTokens: 1024,
  }
  return { history, tokenize, tokenizer, generate, options }
}

describe('native bounded-context verification', () => {
  it('allows a small fallback prompt using the selected native system prompt, wrapper and tokenizer', () => {
    const { options, history, generate, tokenize, tokenizer } = fixture()
    expect(() => assertPreparedPromptFits(options)).not.toThrow()
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      chatHistory: [
        ...history,
        { type: 'user', text: options.prompt },
        { type: 'model', response: [] },
      ],
    })
    expect(tokenize).toHaveBeenCalledExactlyOnceWith(tokenizer)
    expect(history).toEqual([{ type: 'system', text: 'Actual selected system prompt' }])
  })

  it.each([
    { tokens: 2662, fits: true },
    { tokens: 2663, fits: false },
  ])('checks exact prompt/output/native margin boundary $tokens', ({ tokens, fits }) => {
    const { options } = fixture(tokens)
    if (fits) expect(() => assertPreparedPromptFits(options)).not.toThrow()
    else expect(() => assertPreparedPromptFits(options)).toThrow(/smaller.*sources/)
  })

  it('does not grant a smaller context when the native wrapper cannot be measured', () => {
    const { options, generate } = fixture()
    generate.mockImplementation(() => {
      throw new Error('Unsupported wrapper')
    })
    expect(() => assertPreparedPromptFits(options)).toThrow(/prompt size.*verified/)
  })

  it.each([8192, 16384])(
    'measures the prepared prompt at unchanged or grown capacity %s',
    (actual) => {
      const { options, generate } = fixture()
      expect(() =>
        assertPreparedPromptFits({ ...options, actualContextTokens: actual }),
      ).not.toThrow()
      expect(generate).toHaveBeenCalledTimes(1)
    },
  )

  it.each([4096, 8192])('rejects underestimated evidence at actual capacity %s', (actual) => {
    const { options } = fixture(actual - 1024 - Math.ceil(actual / 10) + 1)
    expect(() =>
      assertPreparedPromptFits({
        ...options,
        plannedContextTokens: 4096,
        actualContextTokens: actual,
      }),
    ).toThrow(/sources.*do not fit/)
  })

  it.each([4096, 8192])('fails closed for an unmeasurable wrapper at capacity %s', (actual) => {
    const { options, generate } = fixture()
    generate.mockImplementation(() => {
      throw new Error('Unsupported wrapper')
    })
    expect(() =>
      assertPreparedPromptFits({
        ...options,
        plannedContextTokens: 4096,
        actualContextTokens: actual,
      }),
    ).toThrow(/prompt size.*verified/)
  })

  it('preserves unbounded legacy utility behavior without invoking the tokenizer', () => {
    const { options, generate } = fixture(20_000)
    expect(() =>
      assertPreparedPromptFits({ ...options, plannedContextTokens: undefined }),
    ).not.toThrow()
    expect(generate).not.toHaveBeenCalled()
  })

  it.each([4096, 8192, 16384])('honors cancellation around counting at capacity %s', (actual) => {
    const { options, tokenize, generate } = fixture()
    options.actualContextTokens = actual
    expect(() => assertPreparedPromptFits({ ...options, signal: AbortSignal.abort() })).toThrow(
      /abort/i,
    )
    expect(generate).not.toHaveBeenCalled()
    const controller = new AbortController()
    tokenize.mockImplementation(() => {
      controller.abort()
      return [1]
    })
    expect(() => assertPreparedPromptFits({ ...options, signal: controller.signal })).toThrow(
      /abort/i,
    )
  })

  it('mirrors the public prompt API when the last history item is already a user message', () => {
    const { options, history, generate } = fixture()
    history.push({ type: 'user', text: 'Previous partial user content' })
    expect(countPreparedPromptTokens(options.session, options.prompt)).toBe(500)
    expect(generate).toHaveBeenCalledWith({
      chatHistory: [
        history[0],
        { type: 'user', text: 'Previous partial user content\n\n' + options.prompt },
        { type: 'model', response: [] },
      ],
    })
    expect(history[1]?.text).toBe('Previous partial user content')
  })

  it('uses the actual selected utility context for a raw generation', () => {
    const { options } = fixture(900)
    expect(() =>
      assertPreparedPromptFits({ ...options, actualContextTokens: 2048, maxTokens: 512 }),
    ).not.toThrow()
    expect(() =>
      assertPreparedPromptFits({ ...options, actualContextTokens: 1024, maxTokens: 512 }),
    ).toThrow(/smaller/)
  })
})

describe('utility routing with the actual next system prompt', () => {
  function routingFixture(tokens: number) {
    const base = fixture(tokens)
    const initial = [{ type: 'system' as const, text: 'Load-time system' }]
    const wrapper = {
      settings: { supportsSystemMessages: true },
      generateInitialChatHistory: vi.fn(() => initial),
      generateContextState: base.generate,
    }
    const session = {
      getChatHistory: vi.fn(() => [{ type: 'user', text: 'Existing private utility history' }]),
      chatWrapper: wrapper,
      model: { tokenizer: base.tokenizer },
    }
    const options = {
      session: session as never,
      initialSystemPrompt: 'Load-time system',
      systemPrompt: 'Actual evidence assessment instructions',
      prompt: 'Source passages',
      maxTokens: 384,
      actualContextTokens: 4096,
    }
    return { ...base, initial, session, wrapper, options }
  }

  it('counts the per-call system and wrapper without reading or mutating live history', () => {
    const { options, session, initial, wrapper, generate } = routingFixture(500)
    expect(fitsFreshPromptContext(options)).toBe(true)
    expect(wrapper.generateInitialChatHistory).toHaveBeenCalledWith({
      systemPrompt: 'Load-time system',
    })
    expect(generate).toHaveBeenCalledWith({
      chatHistory: [
        { type: 'system', text: options.systemPrompt },
        { type: 'user', text: options.prompt },
        { type: 'model', response: [] },
      ],
    })
    expect(initial).toEqual([{ type: 'system', text: 'Load-time system' }])
    expect(session.getChatHistory).not.toHaveBeenCalled()
  })

  it.each([
    { tokens: 3302, fits: true },
    { tokens: 3303, fits: false },
  ])('checks exact utility capacity at $tokens prompt tokens', ({ tokens, fits }) => {
    expect(fitsFreshPromptContext(routingFixture(tokens).options)).toBe(fits)
  })

  it('chooses the main context if the native utility wrapper cannot be measured', () => {
    const { options, generate } = routingFixture(100)
    generate.mockImplementation(() => {
      throw new Error('Unsupported wrapper')
    })
    expect(fitsFreshPromptContext(options)).toBe(false)
  })

  it('matches native reset for wrappers without system-message support', () => {
    const { options, wrapper, generate } = routingFixture(100)
    wrapper.settings.supportsSystemMessages = false
    expect(fitsFreshPromptContext(options)).toBe(true)
    expect(wrapper.generateInitialChatHistory).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith({
      chatHistory: [
        { type: 'user', text: options.prompt },
        { type: 'model', response: [] },
      ],
    })
  })
})

describe('chat output allowance after native context restoration', () => {
  it('fits the unchanged factual prompt after an 8K plan restores at 4K', () => {
    const { options, history, generate } = fixture(1819)
    expect(prepareChatPromptBudget({ ...options, maxTokens: 2048 })).toBe(1024)
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      chatHistory: [
        ...history,
        { type: 'user', text: options.prompt },
        { type: 'model', response: [] },
      ],
    })
    expect(options.prompt).toBe('Source text and question')
    expect(history).toEqual([{ type: 'system', text: 'Actual selected system prompt' }])
  })

  it.each([
    { tokens: 2662, fits: true },
    { tokens: 2663, fits: false },
  ])('retains the native evidence boundary at $tokens input tokens', ({ tokens, fits }) => {
    const { options } = fixture(tokens)
    const prepare = () => prepareChatPromptBudget({ ...options, maxTokens: 2048 })
    if (fits) expect(prepare()).toBe(1024)
    else expect(prepare).toThrow(/smaller.*sources/)
  })

  it('preserves an explicit smaller output limit', () => {
    const { options } = fixture(1819)
    expect(prepareChatPromptBudget({ ...options, maxTokens: 512 })).toBe(512)
  })

  it('checks cancellation before and after native token counting', () => {
    const { options, tokenize, generate } = fixture(1819)
    expect(() => prepareChatPromptBudget({ ...options, signal: AbortSignal.abort() })).toThrow(
      /abort/i,
    )
    expect(generate).not.toHaveBeenCalled()
    const controller = new AbortController()
    tokenize.mockImplementation(() => {
      controller.abort()
      return [1]
    })
    expect(() => prepareChatPromptBudget({ ...options, signal: controller.signal })).toThrow(
      /abort/i,
    )
  })

  it('does not change explicit raw-generation budgeting', () => {
    const { options } = fixture(1819)
    expect(() => assertPreparedPromptFits({ ...options, maxTokens: 2048 })).toThrow(/smaller/)
  })
})
