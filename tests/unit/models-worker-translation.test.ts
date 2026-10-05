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
  stopReason: 'eogToken',
  promptWait: null as Promise<void> | null,
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
    resolveChatWrapper: () => new QwenChatWrapper({ variation: '3.5' }),
    getLlama: mocks.getLlama,
    LlamaChatSession: class {
      chatWrapper: import('node-llama-cpp').ChatWrapper
      model = { tokenizer: () => [1] }
      history: Array<{ type: string; text: string }>
      dispose: () => void
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
  mocks.sessions.length = 0
  mocks.instructions.length = 0
  mocks.promptOptions.length = 0
  mocks.lifecycle.length = 0
  mocks.stopReason = 'eogToken'
  mocks.promptWait = null
  mocks.responseText = 'translated'
  mocks.sessionFailure = null
  mocks.totalVramGB = 16
  mocks.gpuGrammar.mockReset().mockResolvedValue({ backend: 'gpu' })
  mocks.cpuGrammar.mockReset()
  mocks.dispose.mockResolvedValue(undefined)
  mocks.getLlama.mockImplementation(async (options) => ({
    gpu: options.gpu === false ? false : 'vulkan',
    loadModel: mocks.loadModel,
    getGpuDeviceNames: async () => ['test GPU'],
    createGrammarForJsonSchema: options.gpu === false ? mocks.cpuGrammar : mocks.gpuGrammar,
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
      postMessage: (response: { id?: number; ok: boolean }) => {
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
  it('does not retain a failed grammar compilation, allowing the next request to retry', async () => {
    await load()
    mocks.gpuGrammar.mockRejectedValueOnce(new Error('Compile failed'))
    const generate = () =>
      request({
        op: 'llm.generateRaw',
        payload: { streamId: 'retry-schema', prompt: 'JSON', jsonSchema: { type: 'object' } },
      })
    expect(await generate()).toMatchObject({ ok: true })
    expect(mocks.promptOptions.at(-1)?.grammar).toBeUndefined()
    expect(await generate()).toMatchObject({ ok: true })
    expect(mocks.gpuGrammar).toHaveBeenCalledTimes(2)
    expect(mocks.promptOptions.at(-1)?.grammar).toEqual({ backend: 'gpu' })
  })
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
  })
})
