import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLlama: vi.fn(),
  loadModel: vi.fn(),
  createContext: vi.fn(),
  dispose: vi.fn(),
  embeddingContext: vi.fn(),
  rankingContext: vi.fn(),
  cpuGrammar: vi.fn(),
  gpuGrammar: vi.fn(),
  compactGrammar: vi.fn(),
  compactGrammarAvailable: true,
  boundedSupported: vi.fn(),
  boundedPlan: vi.fn(),
  boundedGenerate: vi.fn(),
  grammarAvailable: true,
  stopReason: 'eogToken',
  promptWait: null as Promise<void> | null,
  promptHook: null as ((options: Record<string, unknown>) => void | Promise<void>) | null,
  tokenState: vi.fn(),
  tokenDiff: vi.fn(),
  metricsLogFailure: false,
  responseText: 'translated',
  sessionFailure: null as Error | null,
  totalVramGB: 16,
  instructions: [] as string[],
  promptOptions: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<{
    history: Array<{ type: string; text: string }>
    dispose: () => void
  }>,
  lifecycle: [] as string[],
  logs: [] as string[],
}))
vi.mock('@main/services/workers/boundedThoughts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/services/workers/boundedThoughts')>()),
  supportsBoundedThoughts: mocks.boundedSupported,
  planBoundedThoughts: mocks.boundedPlan,
  generateWithBoundedThoughts: mocks.boundedGenerate,
}))
vi.mock('@main/services/embeddings/ResourcePlanner', () => ({
  ggufWeightBytes: () => 1000,
  ResourcePlanner: class {
    refreshIfStale = async () => ({
      hasGpu: true,
      totalVramGB: mocks.totalVramGB,
      freeVramGB: 12,
      vramHeadroomGB: 1,
    })
    refresh = async () => ({
      hasGpu: true,
      totalVramGB: mocks.totalVramGB,
      freeVramGB: 12,
      vramHeadroomGB: 1,
    })
    planLlm = () => ({ contextSize: 8192, kvCacheType: 'f16', reason: 'test' })
  },
}))
vi.mock('node-llama-cpp', async (importOriginal) => {
  const { QwenChatWrapper } = await importOriginal<typeof import('node-llama-cpp')>()
  return {
    QwenChatWrapper,
    LlamaGrammarEvaluationState: class {},
    resolveChatWrapper: () => new QwenChatWrapper({ variation: '3.5' }),
    getLlama: mocks.getLlama,
    LlamaChatSession: class {
      chatWrapper: import('node-llama-cpp').ChatWrapper
      model = { tokenizer: () => [1] }
      history: Array<{ type: string; text: string }>
      dispose: () => void
      sequence = { tokenMeter: { getState: mocks.tokenState, diff: mocks.tokenDiff } }
      constructor(options: {
        systemPrompt: string
        autoDisposeSequence: boolean
        contextSequence: { dispose: () => void }
        chatWrapper: import('node-llama-cpp').ChatWrapper
      }) {
        if (mocks.sessionFailure) throw mocks.sessionFailure
        this.chatWrapper = options.chatWrapper
        this.history = [{ type: 'system', text: options.systemPrompt }]
        this.dispose = () => {
          if (options.autoDisposeSequence) options.contextSequence.dispose()
        }
        mocks.sessions.push(this)
      }
      getChatHistory() {
        return this.history
      }
      setChatHistory(history: typeof this.history) {
        this.history = history
      }
      resetChatHistory() {
        this.history = [{ type: 'system', text: 'constructor prompt' }]
      }
      async promptWithMeta(_text: string, options: Record<string, unknown>) {
        mocks.promptOptions.push(options)
        mocks.instructions.push(this.history[0]!.text)
        await mocks.promptHook?.(options)
        if (mocks.promptWait) await mocks.promptWait
        return { responseText: mocks.responseText, stopReason: mocks.stopReason }
      }
      async prompt(text: string, options: Record<string, unknown>) {
        const result = await this.promptWithMeta(text, options)
        const onTextChunk = options.onTextChunk as ((text: string) => void) | undefined
        onTextChunk?.(result.responseText)
        return result.responseText
      }
    },
  }
})

let receive: (request: unknown) => void
let sequence = 0
const pending = new Map<
  number,
  (response: { ok: boolean; result?: { plan: { contextSize: number } }; error?: string }) => void
>()
const originalPort = Object.getOwnPropertyDescriptor(process, 'parentPort')
const boundedGrammar = () => ({
  get grammar() {
    return String.raw`root ::= "{" whitespace-b-1-4-rule "\"ok\"" ":" [ ]? "true" whitespace-b-0-4-rule "}" "\n\n\n\n" [\n]*
whitespace-b-1-4-rule ::= [\n] ("    " | "\t") | [ ]?
whitespace-b-0-4-rule ::= [\n] | [ ]?`
  },
  get rootRuleName() {
    return 'root'
  },
  get stopGenerationTriggers() {
    return ['\n\n\n\n']
  },
  get trimWhitespaceSuffix() {
    return true
  },
})
const request = (message: Record<string, unknown>) =>
  new Promise<{ ok: boolean; result?: { plan: { contextSize: number } }; error?: string }>(
    (resolve) => {
      const id = ++sequence
      pending.set(id, resolve)
      receive({ ...message, id })
    },
  )
const load = () =>
  request({
    op: 'llm.load',
    payload: {
      modelPath: 'test.gguf',
      profileName: 'full',
      profileDefaultContext: 8192,
      weightsBytes: 1000,
      userContextChoice: 'auto',
      envContextOverride: null,
      language: 'en',
      systemPrompt: 'Chat instructions',
      device: { expectedName: 'test GPU', expectedKind: 'dedicated' },
    },
  })

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  vi.stubEnv('LOKLM_RETRIEVAL_TRACE', '0')
  mocks.sessions.length = 0
  mocks.instructions.length = 0
  mocks.promptOptions.length = 0
  mocks.lifecycle.length = 0
  mocks.logs.length = 0
  mocks.stopReason = 'eogToken'
  mocks.promptWait = null
  mocks.promptHook = null
  mocks.metricsLogFailure = false
  mocks.tokenState.mockReset().mockReturnValue({ usedInputTokens: 100, usedOutputTokens: 10 })
  mocks.tokenDiff.mockReset().mockReturnValue({ usedInputTokens: 80, usedOutputTokens: 7 })
  mocks.responseText = 'translated'
  mocks.sessionFailure = null
  mocks.totalVramGB = 16
  mocks.grammarAvailable = true
  mocks.compactGrammarAvailable = true
  mocks.boundedSupported.mockReset().mockReturnValue(true)
  mocks.boundedPlan.mockReset().mockImplementation((input) => input)
  mocks.boundedGenerate
    .mockReset()
    .mockResolvedValue({ responseText: '{"ok":true}', stopReason: 'eogToken' })
  mocks.gpuGrammar.mockReset().mockResolvedValue({ backend: 'gpu' })
  mocks.compactGrammar
    .mockReset()
    .mockImplementation(async (options) => ({ ...options, backend: 'gpu-compact' }))
  mocks.cpuGrammar.mockReset()
  mocks.dispose.mockResolvedValue(undefined)
  mocks.getLlama.mockImplementation(async (options) => ({
    gpu: options.gpu === false ? false : 'vulkan',
    loadModel: mocks.loadModel,
    getGpuDeviceNames: async () => ['test GPU'],
    createGrammarForJsonSchema: mocks.grammarAvailable
      ? options.gpu === false
        ? mocks.cpuGrammar
        : mocks.gpuGrammar
      : undefined,
    createGrammar: mocks.compactGrammarAvailable ? mocks.compactGrammar : undefined,
  }))
  let contextId = 0
  mocks.createContext.mockImplementation(async () => {
    const id = ++contextId
    return {
      contextSize: 4096,
      getSequence: () => ({ dispose: () => mocks.lifecycle.push(`sequence ${id}`) }),
      dispose: async () => {
        mocks.lifecycle.push(`context ${id}`)
      },
    }
  })
  mocks.embeddingContext.mockResolvedValue({ dispose: vi.fn() })
  mocks.rankingContext.mockResolvedValue({ dispose: vi.fn() })
  mocks.loadModel.mockImplementation(async (opts) => ({
    gpuLayers: typeof opts.gpuLayers === 'number' ? opts.gpuLayers : 8,
    fileInsights: { totalLayers: 33 },
    createContext: mocks.createContext,
    createEmbeddingContext: mocks.embeddingContext,
    createRankingContext: mocks.rankingContext,
    dispose: mocks.dispose,
    tokenize: () => [1],
  }))
  Object.defineProperty(process, 'parentPort', {
    configurable: true,
    value: {
      on: (_event: string, callback: typeof receive) => {
        receive = callback
      },
      postMessage: (response: { id?: number; ok: boolean; message?: string }) => {
        if (mocks.metricsLogFailure && response.message?.startsWith('llm.generateRaw metrics:'))
          throw new Error('Metrics transport unavailable')
        if (typeof response.message === 'string') mocks.logs.push(response.message)
        if (response.id != null) {
          pending.get(response.id)?.(response)
          pending.delete(response.id)
        }
      },
    },
  })
  await import('@main/services/workers/modelsWorker')
})
afterEach(() => {
  if (originalPort) Object.defineProperty(process, 'parentPort', originalPort)
  else Reflect.deleteProperty(process, 'parentPort')
  vi.unstubAllEnvs()
})

describe('translation in the native worker', () => {
  const boundedPayload = (cap = 64) => ({
    streamId: 'bounded',
    prompt: 'Private prompt',
    systemPrompt: 'Private system',
    maxTokens: 2176,
    maxBoundedThoughtTokens: cap,
    jsonSchema: { type: 'object' },
    temperature: 0,
    repeatPenalty: false,
    requireComplete: true,
  })
  const prepareBounded = async () => {
    mocks.gpuGrammar.mockResolvedValue(boundedGrammar())
    await load()
  }

  it.each([191, 193, 256, 192.5, NaN, Infinity, '192', null])(
    'rejects direct RPC reasoning allowance %s before planning or fallback',
    async (cap) => {
      await prepareBounded()
      await expect(
        request({
          op: 'llm.generateRaw',
          payload: { ...boundedPayload(), maxBoundedThoughtTokens: cap },
        }),
      ).resolves.toMatchObject({ ok: false, error: 'Unsupported bounded thought request.' })
      expect(mocks.boundedPlan).not.toHaveBeenCalled()
      expect(mocks.boundedGenerate).not.toHaveBeenCalled()
      expect(mocks.promptOptions).toHaveLength(0)
    },
  )

  it.each([64, 128, 192] as const)(
    'uses the identified adapter with cap %s, safe metadata and restored history',
    async (cap) => {
      await prepareBounded()
      vi.stubEnv('LOKLM_RETRIEVAL_TRACE', '1')
      const history = [
        { type: 'system', text: 'Chat instructions' },
        { type: 'user', text: 'Old private conversation' },
      ]
      mocks.sessions[0]!.history = history
      mocks.boundedGenerate.mockImplementation(async ({ telemetry, createGrammarState }) => {
        expect(createGrammarState()).toBeDefined()
        Object.assign(telemetry, {
          thoughtTokens: 12,
          visibleTokens: 8,
          combinedTokens: 21,
          thoughtTermination: 'natural',
          prefillTokens: 100,
        })
        return { responseText: '{"private":"answer"}', stopReason: 'eogToken' }
      })
      await expect(
        request({ op: 'llm.generateRaw', payload: boundedPayload(cap) }),
      ).resolves.toMatchObject({ ok: true, result: { raw: '{"private":"answer"}' } })
      expect(mocks.boundedPlan).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 2176, maxThoughtTokens: cap }),
      )
      expect(mocks.boundedGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: expect.objectContaining({ maxTokens: 2176, maxThoughtTokens: cap }),
        }),
      )
      expect(mocks.logs.join('\n')).toContain(
        JSON.stringify({ status: 'active', maxThoughtTokens: cap }),
      )
      expect(mocks.promptOptions).toHaveLength(0)
      expect(mocks.sessions[0]!.history).toEqual(history)
      expect(mocks.logs.join('\n')).toContain('boundedReasoning=active')
      expect(mocks.logs.join('\n')).toContain('jsonWhitespace=compact')
      expect(mocks.compactGrammar).toHaveBeenCalledWith({
        grammar: expect.stringContaining('whitespace-b-1-4-rule ::= [ ]?'),
        rootRuleName: 'root',
        stopGenerationTriggers: ['\n\n\n\n'],
        trimWhitespaceSuffix: true,
      })
      expect(mocks.logs.join('\n')).toContain('"thoughtTokens":12')
      expect(mocks.logs.join('\n')).toContain('"combinedTokens":21')
      expect(mocks.logs.join('\n')).not.toMatch(
        /Private prompt|Private system|Old private conversation|private.*answer/,
      )
    },
  )

  it.each([64, 128, 192] as const)(
    'keeps unknown wrappers on the zero-thought path with cap %s and omitted requests distinct',
    async (cap) => {
      mocks.boundedSupported.mockReturnValue(false)
      await load()
      await expect(
        request({ op: 'llm.generateRaw', payload: { ...boundedPayload(cap), noThink: false } }),
      ).resolves.toMatchObject({ ok: true })
      expect(mocks.promptOptions.at(-1)?.budgets).toEqual({ thoughtTokens: 0 })
      expect(mocks.boundedPlan).not.toHaveBeenCalled()
      expect(mocks.boundedGenerate).not.toHaveBeenCalled()
      expect(mocks.logs.join('\n')).toContain('boundedReasoning=unsupported')
      expect(mocks.logs.join('\n')).toContain('jsonWhitespace=default')
      expect(mocks.compactGrammar).not.toHaveBeenCalled()
      await request({ op: 'llm.generateRaw', payload: { streamId: 'ordinary', prompt: 'Utility' } })
      expect(mocks.logs.join('\n')).toContain('boundedReasoning=not_requested')
    },
  )

  it('isolates compact and default cached grammars for the same schema', async () => {
    await prepareBounded()
    const plain = { ...boundedPayload(), maxBoundedThoughtTokens: undefined }
    expect(await request({ op: 'llm.generateRaw', payload: plain })).toMatchObject({ ok: true })
    expect(mocks.promptOptions.at(-1)?.grammar).toEqual(boundedGrammar())
    expect(mocks.compactGrammar).not.toHaveBeenCalled()
    expect(await request({ op: 'llm.generateRaw', payload: boundedPayload() })).toMatchObject({
      ok: true,
    })
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(2)
    expect(mocks.compactGrammar).toHaveBeenCalledOnce()
    expect(await request({ op: 'llm.generateRaw', payload: boundedPayload() })).toMatchObject({
      ok: true,
    })
    expect(await request({ op: 'llm.generateRaw', payload: plain })).toMatchObject({ ok: true })
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(2)
    expect(mocks.compactGrammar).toHaveBeenCalledOnce()
    expect((mocks.promptOptions.at(-1)?.grammar as { grammar: string }).grammar).toBe(
      boundedGrammar().grammar,
    )
    expect(mocks.compactGrammar.mock.calls[0]?.[0].grammar).not.toBe(boundedGrammar().grammar)
  })

  it.each(['shape', 'compile', 'unavailable', 'empty'] as const)(
    'rejects compact grammar %s failures without generating, leaking source data or caching failure',
    async (failure) => {
      if (failure === 'unavailable') mocks.compactGrammarAvailable = false
      await prepareBounded()
      if (failure === 'shape')
        mocks.gpuGrammar.mockResolvedValueOnce({
          ...boundedGrammar(),
          grammar: boundedGrammar().grammar.replace('[\\n] | [ ]?', 'PRIVATE_SCHEMA_VALUE'),
        })
      if (failure === 'compile')
        mocks.compactGrammar.mockRejectedValueOnce(new Error('PRIVATE_SCHEMA_VALUE'))
      if (failure === 'empty') mocks.compactGrammar.mockResolvedValueOnce(null)
      const failed = await request({ op: 'llm.generateRaw', payload: boundedPayload() })
      expect(failed).toMatchObject({
        ok: false,
        error: 'Structured output grammar could not be compiled.',
      })
      expect(JSON.stringify(failed) + mocks.logs.join('\n')).not.toContain('PRIVATE_SCHEMA_VALUE')
      expect(mocks.boundedGenerate).not.toHaveBeenCalled()
      expect(mocks.boundedPlan).not.toHaveBeenCalled()
      expect(mocks.promptOptions).toHaveLength(0)
      if (failure !== 'unavailable') {
        expect(await request({ op: 'llm.generateRaw', payload: boundedPayload() })).toMatchObject({
          ok: true,
        })
        expect(mocks.gpuGrammar).toHaveBeenCalledTimes(2)
      }
      const plain = { ...boundedPayload(), maxBoundedThoughtTokens: undefined }
      expect(await request({ op: 'llm.generateRaw', payload: plain })).toMatchObject({ ok: true })
      expect((mocks.promptOptions.at(-1)?.grammar as { grammar: string }).grammar).toBe(
        boundedGrammar().grammar,
      )
    },
  )

  it.each(
    [64, 128, 192].flatMap((cap) =>
      ['setup', 'runtime', 'sampler', 'cap', 'termination'].map((stage) => ({ cap, stage })),
    ),
  )(
    'fails closed on adapter $stage failure with cap $cap without legacy fallback',
    async ({ stage, cap }) => {
      await prepareBounded()
      const payload = boundedPayload(cap)
      if (stage === 'setup')
        mocks.boundedPlan.mockImplementationOnce(() => {
          throw new Error('verified setup failed')
        })
      if (stage === 'runtime')
        mocks.boundedGenerate.mockRejectedValueOnce(new Error('native generation failed'))
      if (stage === 'sampler') payload.temperature = 0.5
      if (stage === 'cap') payload.maxBoundedThoughtTokens = 65
      if (stage === 'termination')
        mocks.gpuGrammar.mockResolvedValue({
          ...boundedGrammar(),
          stopGenerationTriggers: ['unexpected'],
        })
      await expect(request({ op: 'llm.generateRaw', payload })).resolves.toMatchObject({
        ok: false,
      })
      expect(mocks.promptOptions).toHaveLength(0)
    },
  )

  it.each([64, 128, 192] as const)(
    'holds FIFO through cap %s cancellation cleanup and restores language before reuse',
    async (cap) => {
      await prepareBounded()
      const old = [
        { type: 'system', text: 'Chat instructions' },
        { type: 'user', text: 'Earlier turn' },
      ]
      mocks.sessions[0]!.history = old
      let finish!: () => void
      const cleanup = new Promise<void>((resolve) => {
        finish = resolve
      })
      let signal!: AbortSignal
      mocks.boundedGenerate.mockImplementationOnce(async (options) => {
        signal = options.signal
        await cleanup
        // Even a native callback that returns a value after abort cannot publish it.
        return { responseText: 'late private answer', stopReason: 'eogToken' }
      })
      const active = request({ op: 'llm.generateRaw', payload: boundedPayload(cap) })
      await vi.waitFor(() => expect(mocks.boundedGenerate).toHaveBeenCalledOnce())
      const queued = request({
        op: 'llm.generateRaw',
        payload: { streamId: 'reuse', prompt: 'Next utility' },
      })
      await request({
        op: 'llm.setLanguage',
        payload: { lang: 'de', systemPrompt: 'Aktuelle Anweisungen' },
      })
      await request({ op: 'llm.abort', payload: { streamId: 'bounded' } })
      expect(signal.aborted).toBe(true)
      expect(mocks.promptOptions).toHaveLength(0)
      finish()
      await expect(active).resolves.toMatchObject({ ok: false })
      await expect(queued).resolves.toMatchObject({ ok: true, result: { raw: 'translated' } })
      expect(mocks.sessions[0]!.history).toEqual([
        { type: 'system', text: 'Aktuelle Anweisungen' },
        ...old.slice(1),
      ])
      expect(mocks.logs.join('\n')).not.toContain('late private answer')
    },
  )

  it.each([
    { cap: 64, shutdown: false },
    { cap: 64, shutdown: true },
    { cap: 128, shutdown: false },
    { cap: 128, shutdown: true },
  ])(
    'retires after unsafe cleanup and never reuses native work (cap=$cap, shutdown=$shutdown)',
    async ({ cap, shutdown }) => {
      await prepareBounded()
      let finish!: () => void
      const native = new Promise<void>((resolve) => {
        finish = resolve
      })
      const { UnsafeNativeStateError } = await import('@main/services/workers/boundedThoughts')
      mocks.boundedGenerate.mockImplementationOnce(async ({ onUnsafeState }) => {
        await native
        onUnsafeState()
        throw new UnsafeNativeStateError()
      })
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        const active = request({ op: 'llm.generateRaw', payload: boundedPayload(cap) })
        await vi.waitFor(() => expect(mocks.boundedGenerate).toHaveBeenCalledOnce())
        const queued = request({
          op: 'embedder.load',
          payload: {
            modelPath: 'aux.gguf',
            weightsBytes: 1000,
            contextSize: 512,
            placement: 'gpu',
          },
        })
        if (shutdown) await request({ op: 'shutdown' })
        finish()
        await expect(active).resolves.toMatchObject({
          ok: false,
          error: expect.stringContaining('must restart'),
        })
        await expect(queued).resolves.toMatchObject({
          ok: false,
          error: expect.stringContaining('shutting down'),
        })
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
        expect(mocks.loadModel).toHaveBeenCalledOnce()
        expect(mocks.embeddingContext).not.toHaveBeenCalled()
        expect(mocks.dispose).not.toHaveBeenCalled()
        expect(mocks.lifecycle).toEqual([])
      } finally {
        finish()
        exit.mockRestore()
      }
    },
  )

  it('releases partial chat allocations after session construction fails and retries on demand', async () => {
    mocks.sessionFailure = new Error('Unsupported chat template')
    await expect(load()).resolves.toMatchObject({ ok: false, error: 'Unsupported chat template' })
    expect(mocks.lifecycle).toContain('context 1')
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.loadModel).toHaveBeenCalledOnce()
    mocks.sessionFailure = null
    await expect(
      request({
        op: 'llm.generateRaw',
        payload: { streamId: 'retry-failed-load', prompt: 'Task', maxTokens: 64 },
      }),
    ).resolves.toMatchObject({ ok: true, result: { raw: 'translated' } })
    expect(mocks.loadModel).toHaveBeenCalledTimes(2)
  })

  it('still disposes reranker weights when its context disposal fails', async () => {
    const contextDispose = vi.fn().mockRejectedValue(new Error('Context disposal failed'))
    mocks.rankingContext.mockResolvedValueOnce({ dispose: contextDispose })
    await expect(
      request({
        op: 'reranker.load',
        payload: { modelPath: 'reranker.gguf', weightsBytes: 1000, contextSize: 512 },
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(request({ op: 'reranker.unload' })).resolves.toMatchObject({ ok: true })
    expect(contextDispose).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    await expect(
      request({ op: 'reranker.rank', payload: { query: 'q', documents: ['passage'] } }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('not configured') })
  })

  it.each(['{"value":1}', 'First answer token'])(
    'preserves the first structured or ordinary output: %s',
    async (text) => {
      mocks.responseText = text
      await load()
      const result = await request({
        op: 'llm.generateRaw',
        payload: {
          streamId: 'leading-output',
          prompt: 'Return the result',
          maxTokens: 64,
          plannedContextTokens: 4096,
          noThink: true,
          ...(text.startsWith('{') ? { jsonSchema: { type: 'object' } } : {}),
        },
      })
      expect(result).toMatchObject({ ok: true, result: { raw: text } })
      expect(mocks.promptOptions.at(-1)?.budgets).toEqual({ thoughtTokens: 0 })
      for (const session of mocks.sessions)
        expect(
          (
            session as unknown as {
              chatWrapper: { settings: { segments: { thought: { openOnResponseStart: boolean } } } }
            }
          ).chatWrapper.settings.segments.thought.openOnResponseStart,
        ).toBe(false)
    },
  )

  it('preserves a normal chat first token with the same nonthinking wrapper', async () => {
    mocks.responseText = 'First answer token'
    await load()
    expect(
      await request({
        op: 'llm.ask',
        payload: {
          streamId: 'chat-first',
          prompt: 'Answer',
          maxTokens: 64,
          noThink: true,
          plannedContextTokens: 4096,
        },
      }),
    ).toMatchObject({ ok: true, result: { raw: 'First answer token' } })
    expect(mocks.promptOptions.at(-1)?.budgets).toEqual({ thoughtTokens: 0 })
  })

  it('keeps explicit raw reasoning allowed instead of applying a hard zero budget', async () => {
    await load()
    expect(
      await request({
        op: 'llm.generateRaw',
        payload: {
          streamId: 'reasoning-allowed',
          prompt: 'Consider the evidence',
          maxTokens: 64,
          noThink: false,
        },
      }),
    ).toMatchObject({ ok: true })
    expect(mocks.promptOptions.at(-1)?.budgets).toBeUndefined()
  })

  it('aborts generation on shutdown but drains native work before disposing contexts', async () => {
    await load()
    let finish!: () => void
    mocks.promptWait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    try {
      const generation = request({
        op: 'llm.generateRaw',
        payload: { streamId: 'active', prompt: 'Task' },
      })
      await vi.waitFor(() => expect(mocks.promptOptions).toHaveLength(1))
      const queued = request({
        op: 'embedder.load',
        payload: { modelPath: 'aux.gguf', weightsBytes: 1000, contextSize: 512, placement: 'gpu' },
      })
      await request({ op: 'shutdown' })
      expect((mocks.promptOptions[0]!.signal as AbortSignal).aborted).toBe(true)
      expect(mocks.lifecycle).toEqual([])
      expect(mocks.dispose).not.toHaveBeenCalled()
      expect(exit).not.toHaveBeenCalled()
      finish()
      await generation
      await expect(queued).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('shutting down'),
      })
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(mocks.loadModel).toHaveBeenCalledOnce()
      expect(mocks.dispose).toHaveBeenCalledOnce()
      expect(mocks.lifecycle.length).toBeGreaterThan(0)
    } finally {
      finish()
      exit.mockRestore()
    }
  })

  it('bounds utility generations and disables hidden reasoning by default', async () => {
    await load()
    expect(
      await request({ op: 'llm.generateRaw', payload: { streamId: 'utility', prompt: 'Task' } }),
    ).toMatchObject({ ok: true })
    expect(mocks.promptOptions.at(-1)).toMatchObject({
      maxTokens: 1024,
      budgets: { thoughtTokens: 0 },
    })
  })

  it.each(['cancel', 'shutdown'] as const)(
    'does not begin native generation after %s during chat restoration',
    async (action) => {
      mocks.totalVramGB = 4
      await load()
      await request({
        op: 'embedder.load',
        payload: { modelPath: 'aux.gguf', weightsBytes: 1000, contextSize: 512, placement: 'gpu' },
      })
      let finish!: () => void
      const restoring = new Promise<void>((resolve) => {
        finish = resolve
      })
      const createContext = mocks.createContext.getMockImplementation()!
      const initialContexts = mocks.createContext.mock.calls.length
      mocks.createContext.mockImplementationOnce(async (...args) => {
        await restoring
        return createContext(...args)
      })
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        const generation = request({
          op: 'llm.generateRaw',
          payload: { streamId: 'restoring', prompt: 'Task' },
        })
        await vi.waitFor(() =>
          expect(mocks.createContext).toHaveBeenCalledTimes(initialContexts + 1),
        )
        await request(
          action === 'cancel'
            ? { op: 'llm.abort', payload: { streamId: 'restoring' } }
            : { op: 'shutdown' },
        )
        finish()
        await expect(generation).resolves.toMatchObject({
          ok: false,
          error: expect.stringMatching(action === 'cancel' ? /cancelled/ : /shutting down/),
        })
        expect(mocks.promptOptions).toHaveLength(0)
        if (action === 'shutdown') await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      } finally {
        finish()
        exit.mockRestore()
      }
    },
  )
  it('rejects cancelled requests before loading a model', async () => {
    await request({ op: 'llm.abort', payload: { streamId: 'cancelled' } })
    expect(
      await request({ op: 'llm.ask', payload: { streamId: 'cancelled', prompt: 'Task' } }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('cancelled') })
    expect(mocks.loadModel).not.toHaveBeenCalled()
  })
  it('never restores chat for a queued background title', async () => {
    await load()
    await request({ op: 'llm.unload' })
    mocks.loadModel.mockClear()
    expect(
      await request({
        op: 'llm.generateRaw',
        payload: { streamId: 'title', prompt: 'Title', background: true },
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('parked') })
    expect(mocks.loadModel).not.toHaveBeenCalled()
  })
  it.each(['embedder', 'reranker'])(
    'migrates legacy CPU placement for %s to GPU',
    async (service) => {
      const result = await request({
        op: `${service}.load`,
        payload: {
          modelPath: 'aux.gguf',
          placement: 'cpu',
          weightsBytes: 600e6,
          contextSize: 1024,
        },
      })
      expect(result).toMatchObject({ ok: true, result: { resolvedPlacement: 'gpu' } })
      expect(mocks.loadModel).toHaveBeenCalledWith(expect.objectContaining({ gpuLayers: 'max' }))
      expect(mocks.getLlama).not.toHaveBeenCalledWith(expect.objectContaining({ gpu: false }))
    },
  )
  it('releases a failed auxiliary allocation and never retries on CPU', async () => {
    mocks.embeddingContext.mockRejectedValueOnce(new Error('Not enough VRAM'))
    const result = await request({
      op: 'embedder.load',
      payload: {
        modelPath: 'aux.gguf',
        placement: 'auto',
        weightsBytes: 600e6,
        contextSize: 1024,
      },
    })
    expect(result).toMatchObject({ ok: false, error: 'Not enough VRAM' })
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.loadModel).toHaveBeenCalledOnce()
    expect(mocks.getLlama).not.toHaveBeenCalledWith(expect.objectContaining({ gpu: false }))
  })

  it('rejects direct reranker loading on 4 GiB before evicting the resident chat model', async () => {
    mocks.totalVramGB = 4
    expect((await load()).ok).toBe(true)
    mocks.loadModel.mockClear()
    mocks.dispose.mockClear()
    const result = await request({
      op: 'reranker.load',
      payload: {
        modelPath: 'reranker.gguf',
        placement: 'gpu',
        weightsBytes: 600e6,
        contextSize: 1024,
      },
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('4 GiB GPU') })
    expect(mocks.loadModel).not.toHaveBeenCalled()
    expect(mocks.dispose).not.toHaveBeenCalled()
    // The rejected configuration must not later revive via a rank request.
    expect(
      await request({ op: 'reranker.rank', payload: { query: 'q', documents: ['doc'] } }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('not configured'),
    })
  })

  it('allows explicit reranker swapping on 4 GiB and still loads its layers on the GPU', async () => {
    mocks.totalVramGB = 4
    await load()
    mocks.loadModel.mockClear()
    expect(
      await request({
        op: 'reranker.load',
        payload: {
          modelPath: 'reranker.gguf',
          placement: 'gpu',
          weightsBytes: 600e6,
          contextSize: 1024,
          policy: 'always',
        },
      }),
    ).toMatchObject({ ok: true, result: { resolvedPlacement: 'gpu' } })
    expect(mocks.loadModel).toHaveBeenCalledWith(expect.objectContaining({ gpuLayers: 'max' }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('rechecks policy before a parked reranker reloads on demand', async () => {
    await request({
      op: 'reranker.load',
      payload: {
        modelPath: 'reranker.gguf',
        placement: 'auto',
        weightsBytes: 600e6,
        contextSize: 1024,
      },
    })
    mocks.totalVramGB = 4.1
    await load()
    mocks.loadModel.mockClear()
    mocks.dispose.mockClear()
    expect(
      await request({ op: 'reranker.rank', payload: { query: 'q', documents: ['doc'] } }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Reranking is skipped in Auto'),
    })
    expect(mocks.loadModel).not.toHaveBeenCalled()
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('reserves context before weights and reports the actual allocated context', async () => {
    const result = await load()
    expect(result.ok).toBe(true)
    expect(mocks.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ gpuLayers: { fitContext: { contextSize: 8192 } } }),
    )
    expect(result.result?.plan.contextSize).toBe(4096)
    expect(result).toMatchObject({
      result: {
        modelCapacity: {
          gpuLayers: 8,
          totalModelLayers: 33,
          fullyOnGpu: false,
          contextSize: 4096,
          totalVramGB: 16,
        },
      },
    })
  })
  it('releases both owned sequences before their contexts on reload', async () => {
    await load()
    expect((await load()).ok).toBe(true)
    expect(mocks.lifecycle).toEqual(['sequence 2', 'context 2', 'sequence 1', 'context 1'])
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it('disables repetition only for an explicitly opted-out raw call', async () => {
    await load()
    await request({
      op: 'llm.generateRaw',
      payload: {
        streamId: 'no-repeat',
        prompt: 'Copy JSON',
        jsonSchema: { type: 'object' },
        repeatPenalty: false,
      },
    })
    expect(mocks.promptOptions.at(-1)).toMatchObject({
      repeatPenalty: false,
      grammar: { backend: 'gpu' },
      budgets: { thoughtTokens: 0 },
    })
    await request({
      op: 'llm.generateRaw',
      payload: { streamId: 'default-repeat', prompt: 'Ordinary utility' },
    })
    expect(mocks.promptOptions.at(-1)?.repeatPenalty).toEqual({
      lastTokens: 256,
      penalty: 1.1,
      frequencyPenalty: 0.15,
    })
    await request({
      op: 'llm.ask',
      payload: { streamId: 'chat-repeat', question: 'Chat', prompt: 'Chat', maxTokens: 64 },
    })
    expect(mocks.promptOptions.at(-1)?.repeatPenalty).toEqual({
      lastTokens: 256,
      penalty: 1.1,
      frequencyPenalty: 0.15,
    })
  })

  it('builds grammars on the GPU backend', async () => {
    mocks.gpuGrammar.mockResolvedValue({ backend: 'gpu' })
    expect((await load()).ok).toBe(true)
    expect(
      (
        await request({
          op: 'llm.generateRaw',
          payload: {
            streamId: 'json',
            prompt: 'JSON',
            maxTokens: 32,
            jsonSchema: { type: 'object' },
          },
        })
      ).ok,
    ).toBe(true)
    expect(mocks.gpuGrammar).toHaveBeenCalledOnce()
    expect(mocks.cpuGrammar).not.toHaveBeenCalled()
  })
  it('evicts the least recently used grammar while retaining recently reused schemas', async () => {
    await load()
    const generate = (index: number) =>
      request({
        op: 'llm.generateRaw',
        payload: {
          streamId: `schema-${index}`,
          prompt: 'JSON',
          jsonSchema: { type: 'string', enum: [`source-${index}`] },
        },
      })
    for (let index = 0; index < 16; index++)
      expect(await generate(index)).toMatchObject({ ok: true })
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(16)
    await generate(0) // Most recent; schema 1 is now oldest.
    await generate(16)
    await generate(0)
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(17)
    await generate(1)
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(18)
    expect(mocks.gpuGrammar.mock.calls.at(-1)?.[0]).toEqual({
      type: 'string',
      enum: ['source-1'],
    })
  })
  it('serializes identical schema requests while their first grammar is still compiling', async () => {
    await load()
    let finish!: (grammar: unknown) => void
    mocks.gpuGrammar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const generate = (streamId: string) =>
      request({
        op: 'llm.generateRaw',
        payload: { streamId, prompt: 'JSON', jsonSchema: { type: 'object' } },
      })
    const first = generate('first-schema-request')
    await vi.waitFor(() => expect(mocks.gpuGrammar).toHaveBeenCalledOnce())
    const second = generate('second-schema-request')
    expect(mocks.promptOptions).toHaveLength(0)
    finish({ backend: 'gpu' })
    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ])
    expect(mocks.gpuGrammar).toHaveBeenCalledOnce()
  })
  it('rejects failed grammar compilation without generating and retries on the next request', async () => {
    mocks.totalVramGB = 4
    await load()
    const history = [
      { type: 'system', text: 'Chat instructions' },
      { type: 'user', text: 'Previous chat' },
    ]
    mocks.sessions[0]!.history = history
    mocks.gpuGrammar.mockRejectedValueOnce(new Error('Compile failed'))
    const generate = () =>
      request({
        op: 'llm.generateRaw',
        payload: { streamId: 'retry-schema', prompt: 'JSON', jsonSchema: { type: 'object' } },
      })
    expect(await generate()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/structured output.*compil/i),
    })
    expect(mocks.promptOptions).toHaveLength(0)
    expect(mocks.sessions[0]!.history).toEqual(history)
    expect(await generate()).toMatchObject({ ok: true })
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(2)
    expect(mocks.promptOptions.at(-1)?.grammar).toEqual({ backend: 'gpu' })
  })
  it('rejects an unavailable grammar API while keeping ordinary generation usable', async () => {
    mocks.grammarAvailable = false
    await load()
    expect(
      await request({
        op: 'llm.generateRaw',
        payload: { streamId: 'missing-grammar', prompt: 'JSON', jsonSchema: { type: 'object' } },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/structured output.*unavailable/i) })
    expect(mocks.promptOptions).toHaveLength(0)
    expect(mocks.gpuGrammar).not.toHaveBeenCalled()
    expect(
      await request({
        op: 'llm.generateRaw',
        payload: { streamId: 'ordinary-after-reject', prompt: 'Ordinary answer' },
      }),
    ).toMatchObject({ ok: true })
    expect(mocks.promptOptions).toHaveLength(1)
  })
  it.each([null, undefined])(
    'rejects an empty compiled grammar (%s), without caching it',
    async (grammar) => {
      await load()
      mocks.gpuGrammar.mockResolvedValueOnce(grammar)
      const generate = () =>
        request({
          op: 'llm.generateRaw',
          payload: { streamId: 'empty-grammar', prompt: 'JSON', jsonSchema: { type: 'object' } },
        })
      expect(await generate()).toMatchObject({
        ok: false,
        error: expect.stringMatching(/structured output/i),
      })
      expect(mocks.promptOptions).toHaveLength(0)
      expect(await generate()).toMatchObject({ ok: true })
      expect(mocks.gpuGrammar).toHaveBeenCalledTimes(2)
    },
  )
  it('releases weights after context allocation fails, allowing a fresh retry', async () => {
    mocks.createContext.mockRejectedValue(new Error('No VRAM'))
    expect(await load()).toMatchObject({ ok: false, error: 'No VRAM' })
    expect(mocks.dispose).toHaveBeenCalledTimes(4)
    mocks.createContext.mockResolvedValue({ contextSize: 4096, getSequence: () => ({}) })
    expect((await load()).ok).toBe(true)
  })
  it('isolates translation instructions, restores chat history and rejects truncated output', async () => {
    await load()
    const history = [
      { type: 'system', text: 'Chat instructions' },
      { type: 'user', text: 'Previous chat' },
    ]
    mocks.sessions[0]!.history = history
    const translate = (maxTokens: number) =>
      request({
        op: 'llm.generateRaw',
        payload: {
          streamId: 'translation',
          prompt: 'Hello',
          systemPrompt: 'Translate only',
          temperature: 0,
          maxTokens,
          noThink: true,
          requireComplete: true,
        },
      })
    expect((await translate(256)).ok).toBe(true)
    expect(mocks.sessions[0]!.history).toEqual(history)
    expect(mocks.instructions.at(-1)).toBe('Translate only')
    expect((await translate(5000)).ok).toBe(true)
    expect(mocks.sessions[0]!.history).toEqual(history)
    mocks.stopReason = 'maxTokens'
    expect(await translate(256)).toMatchObject({
      ok: false,
      error: expect.stringContaining('output limit'),
    })
    expect(mocks.logs).toContain(
      'llm.generateRaw completed: task=utility stopReason=maxTokens responseChars=10',
    )
  })
  it.each(['success', 'failure', 'abort'] as const)(
    'preserves a language update during main raw generation after %s',
    async (outcome) => {
      mocks.totalVramGB = 4
      await load()
      expect(mocks.sessions).toHaveLength(1)
      const history = [
        { type: 'system', text: 'Chat instructions' },
        { type: 'user', text: 'Previous chat' },
        { type: 'model', text: 'Previous answer' },
      ]
      mocks.sessions[0]!.history = history
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      mocks.promptHook = async (options) => {
        await gate
        const signal = options.signal as AbortSignal
        if (signal.aborted) throw signal.reason
        if (outcome === 'failure') throw new Error('Native generation failed')
      }
      const generation = request({
        op: 'llm.generateRaw',
        payload: {
          streamId: 'language-during-raw',
          prompt: 'Translate this sentence',
          systemPrompt: 'Translate only',
          maxTokens: 64,
        },
      })
      await vi.waitFor(() => expect(mocks.promptOptions).toHaveLength(1))
      await expect(
        request({
          op: 'llm.setLanguage',
          payload: { lang: 'de', systemPrompt: 'Aktuelle deutsche Anweisungen' },
        }),
      ).resolves.toMatchObject({ ok: true })
      expect(mocks.sessions[0]!.history[0]!.text).toBe('Aktuelle deutsche Anweisungen')
      if (outcome === 'abort') {
        await request({ op: 'llm.abort', payload: { streamId: 'language-during-raw' } })
      }
      release()
      expect(await generation).toMatchObject({ ok: outcome === 'success' })
      expect(mocks.instructions).toEqual(['Translate only'])
      expect(mocks.sessions[0]!.history).toEqual([
        { type: 'system', text: 'Aktuelle deutsche Anweisungen' },
        ...history.slice(1),
      ])
    },
  )
  it('keeps raw completion diagnostics content-free even for unknown stop reasons', async () => {
    await load()
    mocks.stopReason = 'private source content'
    mocks.responseText = 'private generated answer'
    await request({
      op: 'llm.generateRaw',
      payload: { streamId: 'diagnostics', prompt: 'Task', maxTokens: 64 },
    })
    expect(mocks.logs).toContain(
      'llm.generateRaw completed: task=utility stopReason=unknown responseChars=24',
    )
    expect(mocks.logs.join('\n')).not.toContain('private')
  })

  it('reports raw phase/timing/token counts without retaining or logging private chunks', async () => {
    vi.stubEnv('LOKLM_RETRIEVAL_TRACE', '1')
    await load()
    let tick = 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => tick)
    try {
      mocks.responseText = 'PRIVATE SOURCE'
      mocks.gpuGrammar.mockImplementationOnce(async () => {
        tick += 7
        return { backend: 'gpu' }
      })
      mocks.tokenDiff.mockReturnValue({
        usedInputTokens: 80,
        usedOutputTokens: 7,
        unexpectedPrivateText: 'PRIVATE METER CONTENT',
      })
      mocks.promptHook = (options) => {
        const chunk = options.onTextChunk as (text: string) => void
        tick += 20
        chunk(' \n')
        tick += 5
        chunk('PRIVATE')
        tick += 8
        chunk(' SOURCE')
        tick += 7
      }
      expect(
        await request({
          op: 'llm.generateRaw',
          payload: {
            streamId: 'trace-counts',
            prompt: 'PRIVATE QUESTION',
            systemPrompt: 'PRIVATE SYSTEM',
            jsonSchema: { type: 'object' },
            maxTokens: 64,
            requireComplete: true,
            repeatPenalty: false,
          },
        }),
      ).toMatchObject({ ok: true, result: { raw: 'PRIVATE SOURCE' } })
      const record = mocks.logs.find((line) => line.startsWith('llm.generateRaw metrics: '))!
      expect(JSON.parse(record.slice('llm.generateRaw metrics: '.length))).toEqual({
        task: 'utility',
        route: 'utility',
        elapsedMs: 47,
        grammarMs: 7,
        promptFitMs: 0,
        nativeMs: 40,
        firstTextMs: 20,
        lastTextMs: 33,
        firstNonWhitespaceTextMs: 25,
        lastNonWhitespaceTextMs: 33,
        responseChars: 16,
        responseChunks: 3,
        completionReason: 'eogToken',
        cancelled: false,
        usedInputTokens: 80,
        usedOutputTokens: 7,
      })
      expect(mocks.tokenDiff).toHaveBeenCalledWith({ usedInputTokens: 100, usedOutputTokens: 10 })
      expect(mocks.logs.join('\n')).not.toContain('PRIVATE')
      expect(mocks.promptOptions.at(-1)).toMatchObject({
        maxTokens: 64,
        repeatPenalty: false,
        budgets: { thoughtTokens: 0 },
      })
      expect(mocks.promptOptions.at(-1)).not.toHaveProperty('stopOnAbortSignal')
    } finally {
      clock.mockRestore()
    }
  })

  it('records partial counters after native abort while keeping the original rejection', async () => {
    vi.stubEnv('LOKLM_RETRIEVAL_TRACE', '1')
    mocks.totalVramGB = 4
    await load()
    mocks.promptHook = async (options) => {
      const chunk = options.onTextChunk as (text: string) => void
      chunk('PRIVATE PARTIAL')
      const signal = options.signal as AbortSignal
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Native request aborted')), {
          once: true,
        })
      })
    }
    const generation = request({
      op: 'llm.generateRaw',
      payload: { streamId: 'trace-abort', prompt: 'Task', maxTokens: 64 },
    })
    await vi.waitFor(() => expect(mocks.promptOptions).toHaveLength(1))
    await request({ op: 'llm.abort', payload: { streamId: 'trace-abort' } })
    expect(await generation).toMatchObject({ ok: false, error: 'Native request aborted' })
    const record = mocks.logs.find((line) => line.startsWith('llm.generateRaw metrics: '))!
    expect(JSON.parse(record.slice('llm.generateRaw metrics: '.length))).toMatchObject({
      route: 'main',
      cancelled: true,
      completionReason: null,
      responseChars: 15,
      responseChunks: 1,
      nativeMs: expect.any(Number),
      firstNonWhitespaceTextMs: expect.any(Number),
      lastNonWhitespaceTextMs: expect.any(Number),
      usedInputTokens: 80,
      usedOutputTokens: 7,
    })
    expect(mocks.logs.some((line) => line.startsWith('llm.generateRaw completed:'))).toBe(false)
    expect(mocks.logs.join('\n')).not.toContain('PRIVATE')
    expect(mocks.promptOptions.at(-1)).not.toHaveProperty('stopOnAbortSignal')
  })

  it('adds neither callbacks nor token-meter work when tracing is disabled', async () => {
    await load()
    expect(
      await request({ op: 'llm.generateRaw', payload: { streamId: 'untraced', prompt: 'Task' } }),
    ).toMatchObject({ ok: true })
    expect(mocks.promptOptions.at(-1)).not.toHaveProperty('onTextChunk')
    expect(mocks.tokenState).not.toHaveBeenCalled()
    expect(mocks.tokenDiff).not.toHaveBeenCalled()
    expect(mocks.logs.some((line) => line.startsWith('llm.generateRaw metrics:'))).toBe(false)
  })

  it.each(['snapshot', 'diff', 'transport'] as const)(
    'does not let %s diagnostics replace successful output or the original native error',
    async (stage) => {
      vi.stubEnv('LOKLM_RETRIEVAL_TRACE', '1')
      await load()
      if (stage === 'snapshot')
        mocks.tokenState.mockImplementation(() => {
          throw new Error('PRIVATE SNAPSHOT FAILURE')
        })
      if (stage === 'diff')
        mocks.tokenDiff.mockImplementation(() => {
          throw new Error('PRIVATE DIFF FAILURE')
        })
      if (stage === 'transport') mocks.metricsLogFailure = true
      const generate = () =>
        request({ op: 'llm.generateRaw', payload: { streamId: 'metrics-failure', prompt: 'Task' } })
      expect(await generate()).toMatchObject({ ok: true, result: { raw: 'translated' } })
      mocks.promptHook = () => {
        throw new Error('Original native failure')
      }
      expect(await generate()).toMatchObject({ ok: false, error: 'Original native failure' })
      expect(mocks.logs.join('\n')).not.toContain('PRIVATE')
    },
  )

  it('distinguishes grammar failure from native generation without inventing response progress', async () => {
    vi.stubEnv('LOKLM_RETRIEVAL_TRACE', '1')
    await load()
    mocks.gpuGrammar.mockRejectedValueOnce(new Error('PRIVATE GRAMMAR'))
    expect(
      await request({
        op: 'llm.generateRaw',
        payload: { streamId: 'trace-grammar', prompt: 'Task', jsonSchema: { type: 'object' } },
      }),
    ).toMatchObject({ ok: false })
    const record = mocks.logs.find((line) => line.startsWith('llm.generateRaw metrics: '))!
    expect(JSON.parse(record.slice('llm.generateRaw metrics: '.length))).toMatchObject({
      nativeMs: null,
      promptFitMs: null,
      firstTextMs: null,
      lastTextMs: null,
      firstNonWhitespaceTextMs: null,
      lastNonWhitespaceTextMs: null,
      responseChars: 0,
      responseChunks: 0,
      completionReason: null,
    })
    expect(mocks.promptOptions).toHaveLength(0)
    expect(mocks.tokenState).not.toHaveBeenCalled()
    expect(mocks.logs.join('\n')).not.toContain('PRIVATE')
  })
})
