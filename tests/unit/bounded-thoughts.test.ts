import { describe, expect, it, vi } from 'vitest'
import {
  boundedThoughtTelemetry,
  generateWithBoundedThoughts,
  planBoundedThoughts,
  supportsBoundedThoughts,
  UnsafeNativeStateError,
} from '@main/services/workers/boundedThoughts'

type PlanInput = Parameters<typeof planBoundedThoughts>[0]
type RunInput = Parameters<typeof generateWithBoundedThoughts>[0]
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(cap?: 64 | 128 | 192) {
  const prompt = [1, 2, 3, 4, 5, 6, 7]
  const suffix = [8, 9]
  const constructed: unknown[] = []
  const detokenized: number[][] = []
  const tokenText: Record<number, string> = { 100: '{', 101: '}', 102: '\n\n\n\n' }
  class Wrapper {
    variation = '3.5'
    keepOnlyLastThought = true
    settings = { segments: { thought: { suffix: '\n</think>', openOnResponseStart: true } } }
    constructor(options?: unknown) {
      constructed.push(options)
    }
    generateContextState() {
      return { contextText: { tokenize: () => prompt } }
    }
  }
  const model = {
    tokenize: vi.fn(() => [9]),
    tokenizer: vi.fn(),
    isSpecialToken: vi.fn(() => false),
    getTokenAttributes: vi.fn(() => ({ userDefined: true })),
    isEogToken: (token: number) => token === 999,
    detokenize: vi.fn((tokens: number[], special = false) => {
      if (special) return '</think>'
      detokenized.push([...tokens])
      return tokens.map((token) => tokenText[token] ?? 'x').join('')
    }),
  }
  const context = { contextSize: 2048, batchSize: 3 }
  const sdk = { QwenChatWrapper: Wrapper, LlamaText: () => ({ tokenize: () => suffix }) }
  const detectedWrapper = new Wrapper()
  const input = {
    model,
    context,
    sdk,
    detectedWrapper,
    prompt: 'private prompt',
    systemPrompt: 'private system',
    maxTokens: cap !== undefined && cap > 64 ? 256 : 80,
    ...(cap === undefined ? {} : { maxThoughtTokens: cap }),
  } as unknown as PlanInput
  const committed: number[] = []
  const calls: Array<{ tokens: number[]; options: Record<string, unknown> }> = []
  const iterators: Array<{ next: ReturnType<typeof vi.fn>; return: ReturnType<typeof vi.fn> }> = []
  let thoughts = [40, 9]
  let answer = [100, 101, 999]
  const sequence = {
    model,
    context,
    tokenPredictor: undefined,
    clearHistory: vi.fn(async () => {}),
    evaluateWithoutGeneratingNewTokens: vi.fn(async (tokens: number[], options: unknown) => {
      expect(options).toHaveProperty('contextShift')
      committed.push(...tokens)
    }),
    evaluate: vi.fn((tokens: number[], options: Record<string, unknown>) => {
      calls.push({ tokens: [...tokens], options })
      const values = options.grammarEvaluationState ? [...answer] : [...thoughts]
      let first = true
      let pending: number | undefined
      const iterator = {
        next: vi.fn(async () => {
          if (first) {
            committed.push(...tokens)
            first = false
          } else if (pending !== undefined) committed.push(pending)
          pending = values.shift()
          return pending === undefined ? { done: true } : { done: false, value: pending }
        }),
        return: vi.fn(async () => ({ done: true })),
      }
      iterators.push(iterator)
      return iterator
    }),
  }
  const ctrl = new AbortController()
  const telemetry = boundedThoughtTelemetry()
  const grammar = { grammar: 'fresh state' }
  const createGrammarState = vi.fn(() => grammar)
  const onUnsafeState = vi.fn()
  const yieldEventLoop = vi.fn(async () => {})
  const run = () =>
    generateWithBoundedThoughts({
      sequence,
      plan: planBoundedThoughts(input),
      signal: ctrl.signal,
      telemetry,
      createGrammarState,
      onUnsafeState,
      yieldEventLoop,
    } as unknown as RunInput)
  return {
    input,
    run,
    prompt,
    suffix,
    constructed,
    sdk,
    detectedWrapper,
    model,
    context,
    sequence,
    ctrl,
    telemetry,
    createGrammarState,
    onUnsafeState,
    yieldEventLoop,
    calls,
    iterators,
    committed,
    detokenized,
    setThoughts: (values: number[]) => {
      thoughts = values
    },
    setAnswer: (values: number[]) => {
      answer = values
    },
    setAnswerChunks: (chunks: string[]) => {
      answer = chunks.map((text, index) => {
        const token = 500 + index
        tokenText[token] = text
        return token
      })
      answer.push(999)
    },
  }
}

describe('bounded thought adapter admission', () => {
  it('recognizes only the explicit public Qwen3.5 wrapper and verifies user-defined delimiter bytes', () => {
    const f = fixture()
    expect(supportsBoundedThoughts(f.input.detectedWrapper, f.input.sdk)).toBe(true)
    expect(planBoundedThoughts(f.input).thoughtCloseToken).toBe(9)
    expect(f.constructed.at(-1)).toMatchObject({ thoughts: 'auto', variation: '3.5' })
    f.detectedWrapper.variation = '3'
    expect(supportsBoundedThoughts(f.input.detectedWrapper, f.input.sdk)).toBe(false)
    expect(() => planBoundedThoughts(f.input)).toThrow('unavailable')
    expect(supportsBoundedThoughts({ variation: '3.5' } as never, f.input.sdk)).toBe(false)
  })
  it.each(['token-count', 'attributes', 'bytes', 'suffix'] as const)(
    'fails closed on %s boundary corruption',
    (kind) => {
      const f = fixture()
      if (kind === 'token-count') f.model.tokenize.mockReturnValue([9, 10])
      if (kind === 'attributes') f.model.getTokenAttributes.mockReturnValue({ userDefined: false })
      if (kind === 'bytes') f.model.detokenize.mockReturnValue('not the boundary')
      if (kind === 'suffix') f.suffix[1] = 10
      expect(() => planBoundedThoughts(f.input)).toThrow('boundary')
    },
  )
  it('counts exact prompt, total output and safety margin without adding a second thought allowance', () => {
    const f = fixture()
    f.context.contextSize = 200
    f.input.maxTokens = 129 // 7 + 129 + 64 = 200
    expect(planBoundedThoughts(f.input).maxTokens).toBe(129)
    f.input.maxTokens++
    expect(() => planBoundedThoughts(f.input)).toThrow('do not fit')
    f.input.maxTokens = 66
    expect(() => planBoundedThoughts(f.input)).toThrow('cannot fit bounded thoughts')
  })
  it('captures immutable prompt tokens and rejects changed context before native work', async () => {
    const f = fixture()
    const plan = planBoundedThoughts(f.input)
    f.prompt[0] = 999
    expect(plan.promptTokens[0]).toBe(1)
    f.context.batchSize = 5
    await expect(
      generateWithBoundedThoughts({
        sequence: f.sequence,
        plan,
        signal: f.ctrl.signal,
        telemetry: f.telemetry,
        createGrammarState: f.createGrammarState,
        onUnsafeState: f.onUnsafeState,
      } as unknown as RunInput),
    ).rejects.toThrow('context changed')
    expect(f.sequence.clearHistory).not.toHaveBeenCalled()
  })
})

describe('bounded thought allowances', () => {
  it('keeps omitted and explicit 64 identical in native calls, committed tokens and counts', async () => {
    const omitted = fixture()
    const explicit = fixture()
    explicit.input.maxThoughtTokens = 64
    for (const f of [omitted, explicit]) {
      f.setThoughts(Array(64).fill(40))
      f.input.maxTokens = 69
    }
    expect(planBoundedThoughts(omitted.input).maxThoughtTokens).toBe(64)
    expect(await omitted.run()).toEqual(await explicit.run())
    expect(omitted.calls.map((call) => call.tokens)).toEqual(
      explicit.calls.map((call) => call.tokens),
    )
    expect(omitted.committed).toEqual(explicit.committed)
    expect(omitted.detokenized).toEqual(explicit.detokenized)
    const counts = (telemetry: typeof omitted.telemetry) => ({
      ...telemetry,
      firstVisibleMs: null,
      lastVisibleMs: null,
    })
    expect(counts(omitted.telemetry)).toEqual(counts(explicit.telemetry))
  })

  it.each([128, 192] as const)(
    'captures %s immutably and commits the final thought once within the same total allowance',
    async (cap) => {
      const f = fixture()
      f.input.maxThoughtTokens = cap
      f.input.maxTokens = cap + 5
      f.setThoughts(Array.from({ length: cap }, (_, index) => 200 + index))
      const plan = planBoundedThoughts(f.input)
      expect(Object.isFrozen(plan)).toBe(true)
      f.input.maxThoughtTokens = 64
      expect(plan.maxThoughtTokens).toBe(cap)
      await expect(
        generateWithBoundedThoughts({
          sequence: f.sequence,
          plan,
          signal: f.ctrl.signal,
          telemetry: f.telemetry,
          createGrammarState: f.createGrammarState,
          onUnsafeState: f.onUnsafeState,
          yieldEventLoop: f.yieldEventLoop,
        } as unknown as RunInput),
      ).resolves.toEqual({ responseText: '{}', stopReason: 'eogToken' })
      expect(f.calls[1]!.tokens).toEqual([199 + cap, 8, 9])
      expect(f.committed.filter((token) => token === 199 + cap)).toHaveLength(1)
      expect(f.telemetry).toMatchObject({
        thoughtTokens: cap,
        forcedClosingTokens: 2,
        combinedTokens: cap + 5,
        thoughtTermination: 'budget',
      })
      expect(f.detokenized).toEqual([[100], [100, 101]])
      expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
    },
  )

  it.each([128, 192] as const)(
    'allows an early natural boundary at cap %s and enforces the combined output ceiling',
    async (cap) => {
      const natural = fixture()
      natural.input.maxThoughtTokens = cap
      natural.input.maxTokens = cap + 5
      await expect(natural.run()).resolves.toEqual({ responseText: '{}', stopReason: 'eogToken' })
      expect(natural.telemetry).toMatchObject({
        thoughtTokens: 1,
        forcedClosingTokens: 0,
        combinedTokens: 5,
        thoughtTermination: 'natural',
      })
      const bounded = fixture()
      bounded.input.maxThoughtTokens = cap
      bounded.input.maxTokens = cap + 4
      bounded.setThoughts(Array(cap).fill(40))
      await expect(bounded.run()).resolves.toEqual({ responseText: '{}', stopReason: 'maxTokens' })
      expect(bounded.telemetry.combinedTokens).toBe(cap + 4)
    },
  )

  it.each([128, 192] as const)(
    'keeps the 2176 total at cap %s and requires room for the closing tokens and final response',
    (cap) => {
      const f = fixture()
      f.context.contextSize = 8192
      f.input.maxThoughtTokens = cap
      f.input.maxTokens = 2176
      expect(planBoundedThoughts(f.input)).toMatchObject({ maxTokens: 2176, maxThoughtTokens: cap })
      f.input.maxTokens = cap + 2
      expect(() => planBoundedThoughts(f.input)).toThrow('cannot fit bounded thoughts')
    },
  )

  it.each([0, 63, 65, 127, 129, 191, 193, 256, 128.5, 192.5, NaN, null, '128', '192'])(
    'rejects unadmitted runtime cap %s before native work',
    (cap) => {
      const f = fixture()
      f.input.maxThoughtTokens = cap as 64 | 128 | 192
      expect(() => f.run()).toThrow('Unsupported bounded thought allowance')
      expect(f.sequence.clearHistory).not.toHaveBeenCalled()
      expect(f.sequence.evaluate).not.toHaveBeenCalled()
    },
  )
})

describe('bounded thought final stop trigger', () => {
  it.each([4, 5, 6, 8])(
    'removes the first trigger and its same-token suffix from %s LFs',
    async (newlines) => {
      const f = fixture()
      f.setAnswerChunks(['{"ok":true}', '\n'.repeat(newlines)])
      await expect(f.run()).resolves.toEqual({
        responseText: '{"ok":true}',
        stopReason: 'stopGenerationTrigger',
      })
      expect(f.telemetry).toMatchObject({ visibleTokens: 2, combinedTokens: 4 })
      expect(f.iterators[1]!.next).toHaveBeenCalledTimes(2)
      expect(f.iterators.every((iterator) => iterator.return.mock.calls.length === 1)).toBe(true)
      expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
    },
  )

  it.each(
    [
      [1, 3],
      [2, 2],
      [3, 1],
      [1, 1, 1, 1],
      [3, 3],
    ].map((parts) => ({ parts, label: parts.join('+') })),
  )('recognizes a trigger split as $label without keeping excess LFs', async ({ parts }) => {
    const f = fixture()
    f.setAnswerChunks(['{}', ...parts.map((length) => '\n'.repeat(length))])
    await expect(f.run()).resolves.toEqual({
      responseText: '{}',
      stopReason: 'stopGenerationTrigger',
    })
    expect(f.iterators[1]!.next).toHaveBeenCalledTimes(parts.length + 1)
    expect(f.telemetry.visibleTokens).toBe(parts.length + 1)
    expect(f.telemetry.combinedTokens).toBe(parts.length + 3)
  })

  it('preserves escaped JSON newlines in a string and strips only the literal terminator', async () => {
    const f = fixture()
    const body = JSON.stringify({ text: '\n\n\n\n\n\n\n\n' })
    f.setAnswerChunks([body, '\n'.repeat(5)])
    await expect(f.run()).resolves.toEqual({
      responseText: body,
      stopReason: 'stopGenerationTrigger',
    })
    expect(f.iterators[1]!.next).toHaveBeenCalledTimes(2)
  })

  it.each([1, 2, 3])(
    'does not stop on %s literal LFs before more JSON content',
    async (newlines) => {
      const f = fixture()
      const gap = '\n'.repeat(newlines)
      f.setAnswerChunks(['{', gap, '"ok":true}', '\n'.repeat(4)])
      await expect(f.run()).resolves.toEqual({
        responseText: `{${gap}"ok":true}`,
        stopReason: 'stopGenerationTrigger',
      })
      expect(f.iterators[1]!.next).toHaveBeenCalledTimes(4)
    },
  )

  it.each([64, 128, 192] as const)(
    'recognizes a trigger on the final allowed token with thought cap %s',
    async (cap) => {
      const f = fixture(cap)
      f.setThoughts(Array(cap).fill(40))
      f.input.maxTokens = cap + 4 // Thoughts + two forced closing tokens + body + terminal token.
      f.setAnswerChunks(['{}', '\n'.repeat(6)])
      await expect(f.run()).resolves.toEqual({
        responseText: '{}',
        stopReason: 'stopGenerationTrigger',
      })
      expect(f.telemetry.combinedTokens).toBe(f.input.maxTokens)
      expect(f.iterators[1]!.next).toHaveBeenCalledTimes(2)
    },
  )

  it.each([1, 2, 3])(
    'keeps maxTokens for an incomplete %s-LF trigger at the allowance boundary',
    async (newlines) => {
      const f = fixture()
      f.setThoughts(Array(64).fill(40))
      f.input.maxTokens = 68
      const tail = '\n'.repeat(newlines)
      f.setAnswerChunks(['{}', tail])
      await expect(f.run()).resolves.toEqual({ responseText: '{}' + tail, stopReason: 'maxTokens' })
      expect(f.telemetry.combinedTokens).toBe(68)
    },
  )

  it.each([0, 1, 2, 3])(
    'preserves EOG completion without a full trigger (%s trailing LFs)',
    async (newlines) => {
      const f = fixture()
      const body = '{}' + '\n'.repeat(newlines)
      f.setAnswerChunks([body])
      await expect(f.run()).resolves.toEqual({ responseText: body, stopReason: 'eogToken' })
      expect(f.telemetry).toMatchObject({ visibleTokens: 1, combinedTokens: 4 })
      expect(f.iterators[1]!.next).toHaveBeenCalledTimes(2)
    },
  )

  it('honors an abort raised during terminal-token detokenization before returning completion', async () => {
    const f = fixture()
    f.setAnswerChunks(['{}\n\n\n\n\n'])
    const detokenize = f.model.detokenize.getMockImplementation()!
    f.model.detokenize.mockImplementation((tokens, special) => {
      const text = detokenize(tokens, special)
      if (!special) f.ctrl.abort()
      return text
    })
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.iterators[1]!.return).toHaveBeenCalledOnce()
    expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
  })

  it('retires instead of returning a completed answer when the final iterator cannot drain', async () => {
    const f = fixture()
    f.setAnswerChunks(['{}\n\n\n\n\n'])
    const evaluate = f.sequence.evaluate.getMockImplementation()!
    f.sequence.evaluate.mockImplementation((tokens, options) => {
      const iterator = evaluate(tokens, options)
      if (options.grammarEvaluationState)
        iterator.return.mockRejectedValueOnce(new Error('synthetic drain failure'))
      return iterator
    })
    await expect(f.run()).rejects.toThrow(UnsafeNativeStateError)
    expect(f.onUnsafeState).toHaveBeenCalledOnce()
    expect(f.iterators[1]!.return).toHaveBeenCalledOnce()
    expect(f.sequence.clearHistory).toHaveBeenCalledOnce()
  })
})

describe('bounded thought native ownership', () => {
  it('prefills bounded chunks, commits the last prompt/closer once, and never detokenizes thoughts', async () => {
    const f = fixture()
    await expect(f.run()).resolves.toEqual({ responseText: '{}', stopReason: 'eogToken' })
    expect(
      f.sequence.evaluateWithoutGeneratingNewTokens.mock.calls.map(([tokens]) => tokens),
    ).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
    expect(f.calls.map(({ tokens }) => tokens)).toEqual([[7], [9]])
    expect(f.committed).toEqual([1, 2, 3, 4, 5, 6, 7, 40, 9, 100, 101])
    expect(f.calls[0]!.options).not.toHaveProperty('grammarEvaluationState')
    expect(f.calls[1]!.options).toHaveProperty('grammarEvaluationState')
    expect(f.detokenized).toEqual([[100], [100, 101]])
    expect(f.telemetry).toMatchObject({
      prefillTokens: 6,
      prefillBatches: 2,
      thoughtTokens: 1,
      thoughtClosingTokens: 1,
      forcedClosingTokens: 0,
      visibleTokens: 2,
      combinedTokens: 5,
      thoughtTermination: 'natural',
    })
    expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
    expect(f.iterators.every((iterator) => iterator.return.mock.calls.length === 1)).toBe(true)
  })
  it('forces the close at 64, commits the last thought once, and includes forced tokens in the same ceiling', async () => {
    const f = fixture()
    f.setThoughts(Array.from({ length: 64 }, (_, i) => 200 + i))
    f.input.maxTokens = 69
    await expect(f.run()).resolves.toEqual({ responseText: '{}', stopReason: 'eogToken' })
    expect(f.calls[1]!.tokens).toEqual([263, 8, 9])
    expect(f.committed.filter((token) => token === 263)).toHaveLength(1)
    expect(f.telemetry).toMatchObject({
      thoughtTokens: 64,
      forcedClosingTokens: 2,
      combinedTokens: 69,
      thoughtTermination: 'budget',
    })
  })
  it('stops at the combined output cap and supports the exact JSON grammar terminator', async () => {
    const f = fixture()
    f.setThoughts(Array(64).fill(40))
    f.input.maxTokens = 68
    await expect(f.run()).resolves.toEqual({ responseText: '{}', stopReason: 'maxTokens' })
    expect(f.telemetry.combinedTokens).toBe(68)
    const g = fixture()
    g.setAnswer([100, 101, 102])
    await expect(g.run()).resolves.toEqual({
      responseText: '{}',
      stopReason: 'stopGenerationTrigger',
    })
  })
  it('does no native work for an already aborted request', async () => {
    const f = fixture()
    f.ctrl.abort()
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.sequence.clearHistory).not.toHaveBeenCalled()
  })
  it.each([64, 128, 192] as const)(
    'waits for an in-flight prefill before cancelling cap %s without sampling',
    async (cap) => {
      const f = fixture(cap)
      const native = deferred()
      f.sequence.evaluateWithoutGeneratingNewTokens.mockImplementationOnce(
        async () => native.promise,
      )
      let settled = false
      const generation = f.run().finally(() => {
        settled = true
      })
      const rejection = expect(generation).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() =>
        expect(f.sequence.evaluateWithoutGeneratingNewTokens).toHaveBeenCalledOnce(),
      )
      f.ctrl.abort()
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(f.sequence.clearHistory).toHaveBeenCalledOnce()
      native.resolve()
      await rejection
      expect(f.sequence.evaluateWithoutGeneratingNewTokens).toHaveBeenCalledOnce()
      expect(f.sequence.evaluate).not.toHaveBeenCalled()
      expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
    },
  )
  it('observes event-loop abort between prefill batches', async () => {
    const f = fixture()
    f.yieldEventLoop.mockImplementationOnce(async () => {
      f.ctrl.abort()
    })
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.sequence.evaluateWithoutGeneratingNewTokens).toHaveBeenCalledOnce()
    expect(f.sequence.evaluate).not.toHaveBeenCalled()
  })
  it.each(
    ([64, 128, 192] as const).flatMap((cap) =>
      (['thought', 'visible'] as const).map((phase) => ({ cap, phase })),
    ),
  )(
    'drains a pending $phase iterator before resolving cap $cap cancellation',
    async ({ cap, phase }) => {
      const f = fixture(cap)
      const pendingNext = deferred()
      const draining = deferred()
      const original = f.sequence.evaluate.getMockImplementation()!
      f.sequence.evaluate.mockImplementation((tokens, options) => {
        const iterator = original(tokens, options)
        if (Boolean(options.grammarEvaluationState) === (phase === 'visible')) {
          iterator.next.mockImplementationOnce(async () => {
            await pendingNext.promise
            return { done: false, value: 100 }
          })
          iterator.return.mockImplementationOnce(async () => {
            await draining.promise
            return { done: true }
          })
        }
        return iterator
      })
      let settled = false
      const generation = f.run().finally(() => {
        settled = true
      })
      const rejection = expect(generation).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() => expect(f.iterators).toHaveLength(phase === 'thought' ? 1 : 2))
      f.ctrl.abort()
      pendingNext.resolve()
      await vi.waitFor(() => expect(f.iterators.at(-1)!.return).toHaveBeenCalledOnce())
      expect(settled).toBe(false)
      expect(f.sequence.clearHistory).toHaveBeenCalledOnce()
      draining.resolve()
      await rejection
      expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
    },
  )
  it.each(
    ([64, 128, 192] as const).flatMap((cap) =>
      (['initial-clear', 'final-clear', 'thought-drain', 'visible-drain'] as const).map(
        (phase) => ({ cap, phase }),
      ),
    ),
  )(
    'retires on $phase failure with cap $cap without further native cleanup',
    async ({ cap, phase }) => {
      const f = fixture(cap)
      if (phase === 'initial-clear')
        f.sequence.clearHistory.mockRejectedValueOnce(new Error('private native data'))
      if (phase === 'final-clear')
        f.sequence.clearHistory
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('private native data'))
      if (phase.endsWith('drain')) {
        const original = f.sequence.evaluate.getMockImplementation()!
        f.sequence.evaluate.mockImplementation((tokens, options) => {
          const iterator = original(tokens, options)
          if (Boolean(options.grammarEvaluationState) === (phase === 'visible-drain'))
            iterator.return.mockRejectedValueOnce(new Error('private native data'))
          return iterator
        })
      }
      await expect(f.run()).rejects.toThrow(UnsafeNativeStateError)
      expect(f.onUnsafeState).toHaveBeenCalledOnce()
      expect(f.sequence.clearHistory).toHaveBeenCalledTimes(phase === 'final-clear' ? 2 : 1)
      if (phase === 'thought-drain') expect(f.sequence.evaluate).toHaveBeenCalledOnce()
    },
  )
  it('rejects early thought EOG and grammar failure, with full cleanup and no fallback', async () => {
    const f = fixture()
    f.setThoughts([999])
    await expect(f.run()).rejects.toThrow('before the final response')
    expect(f.createGrammarState).not.toHaveBeenCalled()
    expect(f.sequence.clearHistory).toHaveBeenCalledTimes(2)
    const g = fixture()
    g.createGrammarState.mockImplementationOnce(() => {
      throw new Error('grammar unavailable')
    })
    await expect(g.run()).rejects.toThrow('grammar unavailable')
    expect(g.sequence.evaluate).toHaveBeenCalledOnce()
    expect(g.sequence.clearHistory).toHaveBeenCalledTimes(2)
  })
  it('includes prefill time in visible latency and forbids context shift', async () => {
    const f = fixture()
    let clock = 100
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    f.yieldEventLoop.mockImplementation(async () => {
      clock += 50
    })
    try {
      await f.run()
      expect(f.telemetry.firstVisibleMs).toBe(100)
      const options = f.sequence.evaluateWithoutGeneratingNewTokens.mock.calls[0]![1] as {
        contextShift: { strategy: () => void }
      }
      expect(() => options.contextShift.strategy()).toThrow('disabled')
    } finally {
      now.mockRestore()
    }
  })
})
