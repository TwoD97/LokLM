import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { OllamaClient, OllamaError } from '@main/services/providers/ollama/OllamaClient'

describe('OllamaClient', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    /* per-test mocks set in tests */
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it.each([
    [307, 'json'],
    [308, 'json'],
    [307, 'ndjson'],
    [308, 'ndjson'],
  ] as const)(
    'refuses HTTP %i redirects for %s without forwarding private content',
    async (status, format) => {
      const forwarded: string[] = []
      const originals: string[] = []
      const privateBody = { prompt: 'Synthetic private document: violet archive 08:35.' }
      const listen = (server: Server): Promise<string> =>
        new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') return reject(new Error('No HTTP port'))
            resolve(`http://127.0.0.1:${address.port}`)
          })
        })
      const close = (server: Server): Promise<void> =>
        new Promise((resolve, reject) => {
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        })
      // A second loopback origin represents an unapproved redirect destination;
      // this test never sends fixture text to any external service.
      const target = createServer((request, response) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => {
          body += chunk
        })
        request.on('end', () => {
          forwarded.push(body)
          response.end('{"done":true}\n')
        })
      })
      let destination = ''
      const origin = createServer((request, response) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => {
          body += chunk
        })
        request.on('end', () => {
          originals.push(body)
          response.writeHead(status, { location: `${destination}/collect` })
          response.end()
        })
      })
      try {
        destination = await listen(target)
        const client = new OllamaClient({
          baseUrl: await listen(origin),
          bearerToken: 'synthetic-fixture-token',
          timeoutMs: 5000,
        })
        const request =
          format === 'json'
            ? client.postJson('/api/embed', privateBody)
            : client.postNdjson('/api/chat', privateBody).next()
        const result = await request.then(
          () => ({ rejected: false, kind: undefined }),
          (error: unknown) => ({
            rejected: true,
            kind: error instanceof OllamaError ? error.kind : undefined,
          }),
        )
        expect(originals).toEqual([JSON.stringify(privateBody)])
        expect(forwarded).toEqual([])
        expect(result).toEqual({ rejected: true, kind: 'network' })
      } finally {
        await Promise.all([close(origin), close(target)])
      }
    },
  )

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

  it('does not start an already cancelled request', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    const controller = new AbortController()
    controller.abort()
    await expect(c.postNdjson('/api/generate', {}, controller.signal).next()).rejects.toMatchObject(
      {
        kind: 'aborted',
      },
    )
    await expect(c.postJson('/api/embed', {}, controller.signal)).rejects.toMatchObject({
      kind: 'aborted',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels a stalled body read after headers and releases the response', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('{"a":1}\n'))
      },
      cancel,
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    globalThis.fetch = fetchMock as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    const controller = new AbortController()
    const gen = c.postNdjson('/api/chat', {}, controller.signal)
    expect((await gen.next()).value).toEqual({ a: 1 })
    const pendingRead = gen.next()
    controller.abort()
    await expect(pendingRead).rejects.toMatchObject({ kind: 'aborted' })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
  })

  it('does not emit buffered records after cancellation', async () => {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('{"a":1}\n{"a":2}\n'))
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 })) as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    const controller = new AbortController()
    const gen = c.postNdjson('/api/chat', {}, controller.signal)
    expect((await gen.next()).value).toEqual({ a: 1 })
    controller.abort()
    await expect(gen.next()).rejects.toMatchObject({ kind: 'aborted' })
    expect(stream.locked).toBe(false)
  })

  it('cancels an unfinished body and removes listeners when its consumer exits early', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('{"done":true}\n'))
      },
      cancel,
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    globalThis.fetch = fetchMock as never
    const c = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 5000,
    })
    const controller = new AbortController()
    for await (const item of c.postNdjson<{ done: boolean }>('/api/chat', {}, controller.signal)) {
      if (item.done) break
    }
    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
    controller.abort()
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.signal?.aborted).toBe(false)
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
