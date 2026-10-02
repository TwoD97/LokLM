import { describe, it, expect, vi } from 'vitest'
import { OllamaLlmProvider } from '@main/services/providers/ollama/OllamaLlmProvider'
import { OllamaError } from '@main/services/providers/ollama/OllamaClient'

function mkClient(stream: object[]): { postNdjson: ReturnType<typeof vi.fn> } {
  return {
    postNdjson: vi.fn().mockImplementation(async function* () {
      for (const ev of stream) yield ev
    }),
  } as never
}

describe('OllamaLlmProvider', () => {
  it('forwards raw JSON schema and explicit thinking controls without changing task options', async () => {
    const schema = {
      type: 'object',
      properties: { source: { enum: ['doc:1/chunk:2'] } },
      additionalProperties: false,
    }
    const client = mkClient([
      { response: '{"source":' },
      { response: '"doc:1/chunk:2"}', done: true, done_reason: 'stop' },
    ])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const controller = new AbortController()
    expect(
      await provider.generateRaw('Extract the source ID', {
        jsonSchema: schema,
        noThink: true,
        systemPrompt: 'Return evidence as JSON.',
        maxTokens: 128,
        temperature: 0,
        requireComplete: true,
        abortSignal: controller.signal,
      }),
    ).toBe('{"source":"doc:1/chunk:2"}')
    expect(client.postNdjson).toHaveBeenCalledExactlyOnceWith(
      '/api/generate',
      {
        model: 'qwen3:8b',
        prompt: 'Extract the source ID',
        stream: true,
        format: schema,
        think: false,
        system: 'Return evidence as JSON.',
        options: { num_ctx: provider.contextWindowTokens(), num_predict: 128, temperature: 0 },
      },
      controller.signal,
    )
  })

  it('requests thinking when noThink is explicitly false', async () => {
    const client = mkClient([{ response: 'Result', done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await provider.generateRaw('Question', { noThink: false })
    expect(client.postNdjson).toHaveBeenCalledWith(
      '/api/generate',
      expect.objectContaining({ think: true }),
      undefined,
    )
  })

  it('does not override format or thinking for callers that omit them', async () => {
    const client = mkClient([{ response: 'Result', done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await provider.generateRaw('Question', {})
    const body = client.postNdjson.mock.calls[0]![1] as Record<string, unknown>
    expect(body).not.toHaveProperty('format')
    expect(body).not.toHaveProperty('think')
  })

  it.each([400, 422])(
    'keeps unsupported options as HTTP %i client errors without weaker retries',
    async (status) => {
      const client = {
        postNdjson: vi.fn().mockImplementation(async function* () {
          yield await Promise.reject(new OllamaError('client', `HTTP ${status}`, status))
        }),
      }
      const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
      await expect(
        provider.generateRaw('Question', { jsonSchema: { type: 'object' }, noThink: true }),
      ).rejects.toMatchObject({
        kind: 'client',
        status,
        message: expect.stringContaining('selected Ollama model and server'),
      })
      expect(client.postNdjson).toHaveBeenCalledOnce()
    },
  )

  it('preserves non-capability failures instead of relabeling them', async () => {
    const failure = new OllamaError('client', 'HTTP 401', 401)
    const client = {
      postNdjson: vi.fn().mockImplementation(async function* () {
        yield await Promise.reject(failure)
      }),
    }
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await expect(provider.generateRaw('Question', { noThink: true })).rejects.toBe(failure)
    expect(client.postNdjson).toHaveBeenCalledOnce()
  })

  it('rejects an error NDJSON event instead of returning a partial result', async () => {
    const client = mkClient([{ response: '{"source":' }, { error: 'backend stopped' }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await expect(provider.generateRaw('Question', {})).rejects.toMatchObject({
      kind: 'server',
      message: 'backend stopped',
    })
  })

  it.each([{ events: [] }, { events: [{ response: 'Unfinished' }] }])(
    'rejects raw streams without a final done event: %j',
    async ({ events }) => {
      const client = mkClient(events)
      const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
      await expect(provider.generateRaw('Question', {})).rejects.toThrow('before completion')
    },
  )

  it.each([{ requireComplete: true }, { jsonSchema: { type: 'object' } }])(
    'rejects empty output for a complete or structured task: %j',
    async (options) => {
      const client = mkClient([{ response: '  ', done: true }])
      const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
      await expect(provider.generateRaw('Question', options)).rejects.toThrow('no output')
    },
  )

  it('preserves empty complete output for an unconstrained optional task', async () => {
    const client = mkClient([{ done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    expect(await provider.generateRaw('Optional title', {})).toBe('')
  })

  it('does not send raw generation after cancellation', async () => {
    const client = mkClient([{ response: 'Result', done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const controller = new AbortController()
    controller.abort()
    await expect(
      provider.generateRaw('Question', { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postNdjson).not.toHaveBeenCalled()
  })

  it('rejects cancellation during the final raw event rather than publishing output', async () => {
    const controller = new AbortController()
    const client = {
      postNdjson: vi.fn().mockImplementation(async function* () {
        yield { response: 'Partial' }
        controller.abort()
        yield { response: ' result', done: true }
      }),
    }
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await expect(
      provider.generateRaw('Question', { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postNdjson).toHaveBeenCalledOnce()
  })

  it('forwards the QA output reserve instead of relying on server defaults', async () => {
    const client = mkClient([{ done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await provider.ask('Question', [], { maxTokens: 512 })
    expect(client.postNdjson).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        options: { num_predict: 512, num_ctx: provider.contextWindowTokens() },
      }),
      undefined,
    )
  })

  it('does not send a chat request that was already cancelled', async () => {
    const client = mkClient([{ done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const controller = new AbortController()
    controller.abort()
    await expect(provider.ask('Question', [], { abortSignal: controller.signal })).rejects.toThrow()
    expect(client.postNdjson).not.toHaveBeenCalled()
  })

  it('rejects truncated translation output', async () => {
    const client = mkClient([{ response: 'unfinished', done: true, done_reason: 'length' }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await expect(provider.generateRaw('Hello', { requireComplete: true })).rejects.toThrow(
      'output limit',
    )
  })
  it('forwards translation instructions, temperature and cancellation to raw generation', async () => {
    const client = mkClient([{ response: 'Hallo', done: true }])
    const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const controller = new AbortController()
    expect(
      await provider.generateRaw('Hello', {
        systemPrompt: 'Translate faithfully',
        temperature: 0,
        maxTokens: 100,
        abortSignal: controller.signal,
      }),
    ).toBe('Hallo')
    expect(client.postNdjson).toHaveBeenCalledWith(
      '/api/generate',
      expect.objectContaining({
        system: 'Translate faithfully',
        options: { temperature: 0, num_predict: 100, num_ctx: provider.contextWindowTokens() },
      }),
      controller.signal,
    )
  })
  it('accumulates streamed text from /api/chat', async () => {
    const client = mkClient([
      { message: { content: 'hello ' } },
      { message: { content: 'world' } },
      { done: true },
    ])
    const p = new OllamaLlmProvider(client as never, 'qwen3:8b')
    const out = await p.ask('q', [], {})
    expect(out).toBe('hello world')
  })

  it('forwards token chunks via onChunk', async () => {
    const client = mkClient([
      { message: { content: 'a' } },
      { message: { content: 'b' } },
      { done: true },
    ])
    const chunks: string[] = []
    const p = new OllamaLlmProvider(client as never, 'qwen3:8b')
    await p.ask('q', [], { onChunk: (c) => chunks.push(c) })
    expect(chunks.join('')).toBe('ab')
  })
})
