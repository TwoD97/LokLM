import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaClient, OllamaError } from '@main/services/providers/ollama/OllamaClient'

describe('OllamaClient', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    /* per-test mocks set in tests */
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('builds requests with Authorization header when bearer set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: '0.5.0' }), { status: 200 }))
    globalThis.fetch = fetchMock as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: 'tok',
      timeoutMs: 5000,
    })
    await c.version()
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('omits Authorization when no bearer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: '0.5.0' }), { status: 200 }))
    globalThis.fetch = fetchMock as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    await c.version()
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = (init.headers as Record<string, string>) ?? {}
    expect(headers.Authorization).toBeUndefined()
  })

  it('maps connection refused to OllamaError with kind=network', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    await expect(c.version()).rejects.toMatchObject({ kind: 'network' })
  })

  it('maps HTTP 5xx to OllamaError with kind=server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    await expect(c.version()).rejects.toMatchObject({ kind: 'server' })
  })

  it('maps HTTP 4xx (non-408/429) to OllamaError with kind=client', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    await expect(c.version()).rejects.toMatchObject({ kind: 'client' })
  })

  it('lists tags', async () => {
    const tags = { models: [{ name: 'qwen3:8b' }, { name: 'nomic-embed-text' }] }
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(tags), { status: 200 })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    const out = await c.listModels()
    expect(out).toEqual(['qwen3:8b', 'nomic-embed-text'])
  })

  it('does not time out a stream after headers arrive', async () => {
    let resolveStream: (() => void) | null = null
    const gate = new Promise<void>((res) => {
      resolveStream = res
    })
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('{"a":1}\n'))
        // Hold the stream open — simulate a slow LLM response.
        gate.then(() => {
          ctrl.enqueue(new TextEncoder().encode('{"a":2}\n'))
          ctrl.close()
        })
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 50,
    })
    const out: unknown[] = []
    const gen = c.postNdjson<{ a: number }>('/api/chat', {})
    // Read first chunk
    const first = await gen.next()
    out.push(first.value)
    // Wait longer than timeoutMs — the stream timer should be cleared, so this is fine.
    await new Promise((res) => setTimeout(res, 120))
    // Release the second chunk
    ;(resolveStream as (() => void) | null)?.()
    const second = await gen.next()
    if (!second.done) out.push(second.value)
    const final = await gen.next()
    expect(out).toEqual([{ a: 1 }, { a: 2 }])
    expect(final.done).toBe(true)
  })

  it('OllamaError is detectable by instanceof', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    try {
      await c.version()
    } catch (e) {
      expect(e).toBeInstanceOf(OllamaError)
      return
    }
    throw new Error('expected throw')
  })
})
