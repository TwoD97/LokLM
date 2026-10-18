import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionsService } from '@main/services/connections/ConnectionsService'
import { CONNECTIONS_KEY, LIMITS } from '@main/services/connections/validation'
import type { McpConnectionConfig } from '@shared/connections'

const config: McpConnectionConfig = {
  id: 'calendar',
  name: 'My server',
  enabled: false,
  transport: 'http',
  url: 'https://mcp.example/tools',
  headers: { Authorization: 'Bearer secret-token' },
}
const tool = {
  name: 'events.list',
  description: 'List events',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  annotations: { readOnlyHint: true },
}
type Rpc = Record<string, unknown>
const result = (id: unknown, value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result: value }), {
    headers: { 'content-type': 'application/json', ...headers },
  })

function setup(
  handler?: (message: Rpc, request: RequestInit) => Response | Promise<Response> | undefined,
) {
  const kv = new Map<string, string>()
  const store = {
    getKv: (key: string) => kv.get(key) ?? null,
    setKvDurably: vi.fn(async (key: string, value: string) => {
      kv.set(key, value)
    }),
  }
  const requests: Array<{ message: Rpc; request: RequestInit }> = []
  const fetcher = vi.fn<typeof fetch>(async (_url, request = {}) => {
    if (request.method === 'DELETE') return new Response(null, { status: 405 })
    const message = JSON.parse(String(request.body)) as Rpc
    requests.push({ message, request })
    const custom = await handler?.(message, request)
    if (custom) return custom
    if (!('id' in message) || !('method' in message)) return new Response(null, { status: 202 })
    if (message.method === 'initialize')
      return result(
        message.id,
        {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture', version: '1' },
        },
        { 'Mcp-Session-Id': 'session-private' },
      )
    if (message.method === 'tools/list') return result(message.id, { tools: [tool] })
    return result(message.id, { content: [{ type: 'text', text: 'event list' }] })
  })
  const service = new ConnectionsService(store, () => true, { fetch: fetcher })
  return { service, store, kv, fetcher, requests }
}

afterEach(() => vi.restoreAllMocks())

describe('MCP connection lifecycle and persistence', () => {
  it('stores secrets durably, redacts summaries, preserves omitted secrets, and never connects on save', async () => {
    const { service, store, fetcher, kv } = setup()
    const saved = await service.save(config)
    expect(saved).toMatchObject({
      status: 'disconnected',
      enabled: false,
      secretKeys: ['header:Authorization'],
    })
    expect(JSON.stringify(saved)).not.toContain('secret-token')
    expect(fetcher).not.toHaveBeenCalled()
    const withoutSecrets = { ...config }
    delete withoutSecrets.headers
    await service.save({ ...withoutSecrets, name: 'Renamed' })
    expect(JSON.parse(kv.get(CONNECTIONS_KEY)!).connections[0].headers).toEqual(config.headers)
    expect(store.setKvDurably).toHaveBeenCalledTimes(2)
    await service.save({ ...config, headers: {} })
    expect((await service.list())[0]?.secretKeys).toEqual([])
  })

  it('connects with negotiated headers, discovers tools, and never trusts readOnlyHint to grant execution', async () => {
    const { service, requests } = setup()
    await service.save(config)
    expect(await service.connect(config.id)).toMatchObject({
      status: 'connected',
      enabled: true,
      toolCount: 1,
    })
    expect(requests.map(({ message }) => message.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])
    expect(requests[0]?.message.params).toMatchObject({ capabilities: {} })
    expect(requests[1]?.request.headers).toMatchObject({
      'MCP-Session-Id': 'session-private',
      'MCP-Protocol-Version': '2025-06-18',
      Authorization: 'Bearer secret-token',
    })
    const [entry] = service.tools()
    expect(entry).toMatchObject({
      source: 'mcp',
      effect: 'external',
      name: 'events.list',
      connectionId: config.id,
    })
    expect(await service.call(entry!.id, { query: 'today' })).toBe('event list')
    expect(requests.at(-1)?.message.params).toEqual({
      name: 'events.list',
      arguments: { query: 'today' },
    })
    expect(requests.every(({ request }) => request.redirect === 'error')).toBe(true)
    await service.disconnect(config.id)
    expect(service.tools()).toEqual([])
    expect((await service.list())[0]).toMatchObject({ enabled: false, status: 'disconnected' })
  })

  it('retires approval IDs across reconnect and configuration edits, and returns detached descriptors', async () => {
    const { service, requests } = setup()
    await service.save(config)
    await service.connect(config.id)
    const previous = service.tools()[0]!
    previous.inputSchema.type = 'string'
    expect(service.tools()[0]!.inputSchema.type).toBe('object')
    await service.disconnect(config.id)
    await service.connect(config.id)
    expect(service.tools()[0]!.id).not.toBe(previous.id)
    await expect(service.call(previous.id, {})).rejects.toThrow('unavailable or changed')
    const current = service.tools()[0]!.id
    await service.save({ ...config, name: 'Changed' })
    await expect(service.call(current, {})).rejects.toThrow('unavailable or changed')
    expect(requests.filter(({ message }) => message.method === 'tools/call')).toHaveLength(0)
  })

  it('does not publish failed writes or poison the mutation queue', async () => {
    const { service, store } = setup()
    store.setKvDurably.mockRejectedValueOnce(new Error('disk failure'))
    await expect(service.save(config)).rejects.toThrow('could not be saved')
    expect(await service.list()).toEqual([])
    await service.save(config)
    expect(await service.list()).toHaveLength(1)
  })

  it('drains admitted persistence but rejects queued and stale-session work after invalidation', async () => {
    const { service, store, kv, fetcher } = setup()
    let finish!: () => void
    store.setKvDurably.mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      kv.set(key, value)
    })
    const saving = service.save(config)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const queued = service.save({ ...config, id: 'later' })
    const expected = Promise.all([
      expect(saving).rejects.toThrow('locked'),
      expect(queued).rejects.toThrow('locked'),
    ])
    service.invalidate()
    let drained = false
    const drain = service.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    finish()
    await expected
    await drain
    expect(store.setKvDurably).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(service.tools()).toEqual([])
    await expect(service.list()).rejects.toThrow('locked')
  })

  it('disconnects initialization even when connect and disconnect are issued in the same turn', async () => {
    const { service } = setup()
    await service.save(config)
    const connecting = service.connect(config.id).catch(() => undefined)
    await service.disconnect(config.id)
    await connecting
    expect(service.tools()).toEqual([])
    expect((await service.list())[0]).toMatchObject({ enabled: false, status: 'disconnected' })
  })
})

describe('MCP HTTP protocol', () => {
  it('walks paginated tools and rejects repeated cursors', async () => {
    let repeats = false
    const { service } = setup((message) => {
      if (message.method !== 'tools/list') return undefined
      const cursor = (message.params as Rpc).cursor
      return result(
        message.id,
        cursor
          ? {
              tools: [{ ...tool, name: 'events.second' }],
              ...(repeats ? { nextCursor: 'next' } : {}),
            }
          : { tools: [tool], nextCursor: 'next' },
      )
    })
    await service.save(config)
    expect(await service.connect(config.id)).toMatchObject({ toolCount: 2 })
    await service.disconnect(config.id)
    repeats = true
    await expect(service.connect(config.id)).rejects.toThrow('pagination did not advance')
    expect(service.tools()).toEqual([])
    service.invalidate()
    await service.drain()
  })

  it.each(['\r\n', '\n', '\r'])(
    'parses fragmented SSE including server ping using line ending %j',
    async (ending) => {
      const cancelled = vi.fn()
      const { service, requests } = setup((message) => {
        if (message.method !== 'tools/call') return undefined
        const stream = `: comment\r\ndata:\r\n\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'server-ping', method: 'ping' })}\r\n\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'Grüße' }] } })}\r\n\r\n`
        const bytes = new TextEncoder().encode(stream.replaceAll('\r\n', ending))
        return new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3))
            },
            cancel: cancelled,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      })
      await service.save(config)
      await service.connect(config.id)
      expect(await service.call(service.tools()[0]!.id, {})).toBe('Grüße')
      expect(requests.find(({ message }) => message.id === 'server-ping')?.message).toEqual({
        jsonrpc: '2.0',
        id: 'server-ping',
        result: {},
      })
      expect(cancelled).toHaveBeenCalledOnce()
      service.invalidate()
      await service.drain()
    },
  )

  it('cancels an unfinished response, sends cancellation, and never retries a tool call', async () => {
    const bodyCancelled = vi.fn()
    const { service, requests } = setup((message) =>
      message.method === 'tools/call'
        ? new Response(new ReadableStream({ cancel: bodyCancelled }), {
            headers: { 'content-type': 'text/event-stream' },
          })
        : undefined,
    )
    await service.save(config)
    await service.connect(config.id)
    const controller = new AbortController()
    const call = service.call(service.tools()[0]!.id, {}, controller.signal)
    const rejected = expect(call).rejects.toThrow('external outcome may be unknown')
    await vi.waitFor(() =>
      expect(requests.some(({ message }) => message.method === 'tools/call')).toBe(true),
    )
    controller.abort()
    await rejected
    expect(bodyCancelled).toHaveBeenCalledOnce()
    expect(requests.filter(({ message }) => message.method === 'tools/call')).toHaveLength(1)
    expect(requests.some(({ message }) => message.method === 'notifications/cancelled')).toBe(true)
    service.invalidate()
    await service.drain()
  })

  it('retires tools on an expired session without replaying a side effect', async () => {
    const { service, requests } = setup((message) =>
      message.method === 'tools/call' ? new Response('secret-token', { status: 404 }) : undefined,
    )
    await service.save(config)
    await service.connect(config.id)
    await expect(service.call(service.tools()[0]!.id, {})).rejects.toThrow()
    expect(service.tools()).toEqual([])
    expect(requests.filter(({ message }) => message.method === 'initialize')).toHaveLength(1)
    expect(requests.filter(({ message }) => message.method === 'tools/call')).toHaveLength(1)
    await service.drain()
  })

  it('bounds concurrent HTTP calls and releases all of them on session invalidation', async () => {
    const { service, requests } = setup((message) =>
      message.method === 'tools/call'
        ? new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } })
        : undefined,
    )
    await service.save(config)
    await service.connect(config.id)
    const toolId = service.tools()[0]!.id
    const calls = Array.from({ length: 8 }, () => service.call(toolId, {}))
    const settled = Promise.allSettled(calls)
    await expect(service.call(toolId, {})).rejects.toThrow('Too many MCP requests')
    service.invalidate()
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true)
    await service.drain()
    expect(requests.filter(({ message }) => message.method === 'tools/call')).toHaveLength(8)
  })

  it.each(['wrong-id', 'oversized', 'truncated', 'tool-error', 'list-changed'])(
    'rejects %s responses without exposing configured secrets',
    async (kind) => {
      const { service } = setup((message) => {
        if (message.method !== 'tools/call') return undefined
        if (kind === 'wrong-id') return result(999, { content: [] })
        if (kind === 'oversized')
          return result(message.id, {
            content: [{ type: 'text', text: 'a'.repeat(LIMITS.messageBytes) }],
          })
        if (kind === 'truncated')
          return new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
        if (kind === 'list-changed')
          return new Response(
            `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\n`,
            { headers: { 'content-type': 'text/event-stream' } },
          )
        return result(message.id, {
          isError: true,
          content: [{ type: 'text', text: 'failed with bare secret-token' }],
        })
      })
      await service.save(config)
      await service.connect(config.id)
      const failure = await service.call(service.tools()[0]!.id, {}).catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).not.toContain('secret-token')
      if (kind === 'list-changed') expect(service.tools()).toEqual([])
      service.invalidate()
      await service.drain()
    },
  )
})

describe('MCP configuration boundary', () => {
  it.each([
    'http://localhost/mcp',
    'http://example.org/mcp',
    'file:///tmp/mcp',
    'https://user:pass@example.org/mcp',
    'https://example.org/mcp#token',
  ])('rejects unsafe URL %s', async (url) => {
    const { service, fetcher } = setup()
    await expect(service.save({ ...config, url })).rejects.toThrow('MCP_INVALID')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['http://127.0.0.1:9000/mcp', 'http://127.2.3.4/mcp', 'http://[::1]:9000/mcp'])(
    'permits literal loopback %s',
    async (url) => {
      const { service } = setup()
      expect((await service.save({ ...config, url })).url).toBe(url)
    },
  )
  it.each([
    { 'MCP-Session-Id': 'forged' },
    { Host: 'evil' },
    { Authorization: 'a\r\nb' },
    { 'Content-Length': '42' },
  ])('rejects reserved or invalid headers %#', async (headers) => {
    await expect(setup().service.save({ ...config, headers })).rejects.toThrow('MCP_INVALID')
  })
  it('fails closed on corrupt stored configuration', async () => {
    const { service, kv } = setup()
    kv.set(CONNECTIONS_KEY, '{invalid')
    await expect(service.list()).rejects.toThrow('No configuration was changed')
    await expect(service.save(config)).rejects.toThrow('No configuration was changed')
    expect(kv.get(CONNECTIONS_KEY)).toBe('{invalid')
  })
})
