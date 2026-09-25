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
vi.mock('node-llama-cpp', () => ({
  getLlama: mocks.getLlama,
  LlamaChatSession: class {
    history: Array<{ type: string; text: string }>
    dispose: () => void
    constructor(options: {
      systemPrompt: string
      autoDisposeSequence: boolean
      contextSequence: { dispose: () => void }
    }) {
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
      return { responseText: 'translated', stopReason: mocks.stopReason }
    }
  },
}))

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
  mocks.totalVramGB = 16
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
