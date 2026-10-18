import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OllamaClient, OllamaError } from '@main/services/providers/ollama/OllamaClient'

const encoder = new TextEncoder()

function bodyStream(initial = '', cancel = vi.fn()) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      if (initial) controller.enqueue(encoder.encode(initial))
    },
    cancel,
  })
  return { body, controller, cancel }
}

describe('OllamaClient response lifecycle', () => {
  let client: OllamaClient
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      timeoutMs: 100,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not fetch when JSON or streaming callers are already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(client.postJson('/api/chat', {}, controller.signal)).rejects.toMatchObject({
      kind: 'aborted',
    })
    await expect(
      client.postNdjson('/api/chat', {}, controller.signal).next(),
    ).rejects.toMatchObject({ kind: 'aborted' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['json', 'ndjson'])('keeps redirects disabled for %s requests', async (format) => {
    fetchMock.mockResolvedValue(new Response('{"done":true}\n'))
    if (format === 'json') await client.postJson('/api/chat', {})
    else {
      const generator = client.postNdjson('/api/chat', {})
      await generator.next()
      await generator.return(undefined)
    }

    expect(fetchMock.mock.calls[0]![1]!.redirect).toBe('error')
  })

  it('cancels a late response after the header deadline has already expired', async () => {
    const stream = bodyStream()
    let resolveFetch!: (response: Response) => void
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    const failure = expect(client.postJson('/api/chat', {})).rejects.toMatchObject({
      kind: 'timeout',
    })
    await vi.advanceTimersByTimeAsync(100)
    await failure
    resolveFetch(new Response(stream.body))
    await vi.advanceTimersByTimeAsync(0)

    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out and closes a JSON body stalled after headers', async () => {
    const stream = bodyStream('{"answer":')
    fetchMock.mockResolvedValue(new Response(stream.body))
    const request = client.postJson('/api/chat', {})
    const failure = expect(request).rejects.toMatchObject({ kind: 'timeout' })

    await vi.advanceTimersByTimeAsync(100)
    await failure

    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(stream.body.locked).toBe(false)
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies a total deadline to JSON even when its body makes progress', async () => {
    const stream = bodyStream()
    fetchMock.mockResolvedValue(new Response(stream.body))
    const failure = expect(client.postJson('/api/embed', {})).rejects.toMatchObject({
      kind: 'timeout',
    })

    await vi.advanceTimersByTimeAsync(60)
    stream.controller.enqueue(encoder.encode('{"embeddings":'))
    await vi.advanceTimersByTimeAsync(40)
    await failure

    expect(stream.cancel).toHaveBeenCalledOnce()
  })

  it('bounds stalled streaming reads after already delivering a token', async () => {
    const stream = bodyStream('{"response":"hello"}\n')
    fetchMock.mockResolvedValue(new Response(stream.body))
    const generator = client.postNdjson('/api/generate', {})
    expect((await generator.next()).value).toEqual({ response: 'hello' })
    const failure = expect(generator.next()).rejects.toMatchObject({ kind: 'timeout' })

    await vi.advanceTimersByTimeAsync(100)
    await failure

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors abort during a pending JSON body read and removes the caller listener', async () => {
    const stream = bodyStream()
    fetchMock.mockResolvedValue(new Response(stream.body))
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const failure = expect(
      client.postJson('/api/chat', {}, controller.signal),
    ).rejects.toMatchObject({ kind: 'aborted' })
    await vi.advanceTimersByTimeAsync(0)

    controller.abort(new Error('user stopped generation'))
    await failure

    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(stream.body.locked).toBe(false)
    expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0]![1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors abort during a pending streaming read', async () => {
    const stream = bodyStream('{"response":"hello"}\n')
    fetchMock.mockResolvedValue(new Response(stream.body))
    const controller = new AbortController()
    const generator = client.postNdjson('/api/generate', {}, controller.signal)
    await generator.next()
    const failure = expect(generator.next()).rejects.toBeInstanceOf(OllamaError)
    controller.abort()
    await failure

    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(stream.body.locked).toBe(false)
  })

  it('does not yield buffered lines after a caller abort', async () => {
    const stream = bodyStream('{"a":1}\n{"a":2}\n')
    fetchMock.mockResolvedValue(new Response(stream.body))
    const controller = new AbortController()
    const generator = client.postNdjson('/api/chat', {}, controller.signal)
    await generator.next()
    controller.abort()
    expect(stream.cancel).toHaveBeenCalledOnce()

    await expect(generator.next()).rejects.toMatchObject({ kind: 'aborted' })
    expect(stream.cancel).toHaveBeenCalledOnce()
  })

  it('cancels an early exit without waiting on a stalled cancel hook', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const stream = bodyStream('{"a":1}\n', cancel)
    fetchMock.mockResolvedValue(new Response(stream.body))
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    for await (const value of client.postNdjson('/api/chat', {}, controller.signal)) {
      expect(value).toEqual({ a: 1 })
      break
    }

    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.body.locked).toBe(false)
    controller.abort()
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false)
    expect(removeListener).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows an active stream to run longer than the timeout', async () => {
    const stream = bodyStream()
    fetchMock.mockResolvedValue(new Response(stream.body))
    const generator = client.postNdjson<{ a: number }>('/api/chat', {})

    for (const a of [1, 2, 3]) {
      const next = generator.next()
      await vi.advanceTimersByTimeAsync(75)
      stream.controller.enqueue(encoder.encode(JSON.stringify({ a }) + '\n'))
      expect((await next).value).toEqual({ a })
    }
    stream.controller.close()
    expect((await generator.next()).done).toBe(true)
    expect(stream.cancel).not.toHaveBeenCalled()
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not charge consumer processing time against the read idle timeout', async () => {
    const stream = bodyStream('{"a":1}\n')
    fetchMock.mockResolvedValue(new Response(stream.body))
    const generator = client.postNdjson('/api/chat', {})
    await generator.next()

    await vi.advanceTimersByTimeAsync(500)
    stream.controller.enqueue(encoder.encode('{"a":2}\n'))
    stream.controller.close()

    expect((await generator.next()).value).toEqual({ a: 2 })
    expect((await generator.next()).done).toBe(true)
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false)
  })

  it('decodes split UTF-8, blank lines, CRLF, and a final line without a newline', async () => {
    const stream = bodyStream()
    for (const byte of encoder.encode('\n{"text":"Grüße 🌍"}\r\n\n{"text":"尾"}')) {
      stream.controller.enqueue(Uint8Array.of(byte))
    }
    stream.controller.close()
    fetchMock.mockResolvedValue(new Response(stream.body))
    const values: unknown[] = []

    for await (const value of client.postNdjson('/api/chat', {})) values.push(value)

    expect(values).toEqual([{ text: 'Grüße 🌍' }, { text: '尾' }])
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies malformed JSON as a server error', async () => {
    fetchMock.mockResolvedValue(new Response('{broken'))

    await expect(client.postJson('/api/chat', {})).rejects.toMatchObject({
      name: 'OllamaError',
      kind: 'server',
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes malformed NDJSON after partial output without retrying', async () => {
    const stream = bodyStream('{"a":1}\n{broken}\n')
    fetchMock.mockResolvedValue(new Response(stream.body))
    const generator = client.postNdjson('/api/chat', {})
    await generator.next()

    await expect(generator.next()).rejects.toMatchObject({ kind: 'server' })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(stream.body.locked).toBe(false)
  })

  it('classifies a malformed final NDJSON line without a newline as a server error', async () => {
    fetchMock.mockResolvedValue(new Response('{"a":1}\n{broken'))
    const generator = client.postNdjson('/api/chat', {})
    await generator.next()

    await expect(generator.next()).rejects.toMatchObject({ kind: 'server' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies body read failures as network errors', async () => {
    const stream = bodyStream()
    fetchMock.mockResolvedValue(new Response(stream.body))
    const failure = expect(client.postJson('/api/chat', {})).rejects.toMatchObject({
      kind: 'network',
      message: 'connection reset',
    })
    await vi.advanceTimersByTimeAsync(0)
    stream.controller.error(new Error('connection reset'))

    await failure
    expect(stream.body.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    [404, 'client'],
    [408, 'server'],
    [429, 'server'],
    [503, 'server'],
  ])('closes HTTP %i bodies and preserves their %s error classification', async (status, kind) => {
    const stream = bodyStream()
    fetchMock.mockResolvedValue(new Response(stream.body, { status: Number(status) }))

    await expect(client.version()).rejects.toMatchObject({ kind, status })

    expect(stream.cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects nonserializable request bodies as client errors without fetching', async () => {
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    await expect(
      client.postJson('/api/chat', { count: 1n }, controller.signal),
    ).rejects.toMatchObject({ kind: 'client' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(addListener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
