import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionsService } from '@main/services/connections/ConnectionsService'
import { LIMITS } from '@main/services/connections/validation'

type Rpc = Record<string, unknown>
const tool = { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }
const spawnProbe = spawnSync(process.execPath, ['-e', ''], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME },
})
const subprocessDenied =
  spawnProbe.error !== undefined &&
  ['EPERM', 'EACCES'].includes((spawnProbe.error as NodeJS.ErrnoException).code ?? '')

class FakeProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin: Writable
  sent: Rpc[] = []
  stopped = false
  kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    if (this.ignoreTerminate && signal === 'SIGTERM') return true
    if (!this.stopped) {
      this.stopped = true
      queueMicrotask(() => this.emit('close', 0))
    }
    return true
  })
  constructor(
    private readonly handler?: (message: Rpc, process: FakeProcess) => boolean,
    private readonly ignoreTerminate = false,
  ) {
    super()
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const text = String(chunk)
        expect(text.endsWith('\n')).toBe(true)
        const message = JSON.parse(text) as Rpc
        this.sent.push(message)
        callback()
        queueMicrotask(() => {
          if (this.handler?.(message, this)) return
          if (message.method === 'initialize')
            this.respond(message.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} } })
          if (message.method === 'tools/list') this.respond(message.id, { tools: [tool] })
          if (message.method === 'tools/call')
            this.respond(message.id, {
              content: [{ type: 'text', text: JSON.stringify(message.params) }],
            })
        })
      },
    })
    queueMicrotask(() => this.emit('spawn'))
  }
  respond(id: unknown, result: unknown): void {
    // Split JSON lines to exercise buffering instead of one-chunk assumptions.
    const message = `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`
    this.stdout.write(message.slice(0, 4))
    this.stdout.write(message.slice(4))
  }
}

function setup(handler?: (message: Rpc, process: FakeProcess) => boolean, ignoreTerminate = false) {
  const processes: FakeProcess[] = []
  const spawnFake = vi.fn(() => {
    const child = new FakeProcess(handler, ignoreTerminate)
    processes.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  })
  const kv = new Map<string, string>()
  const store = {
    getKv: (key: string) => kv.get(key) ?? null,
    setKvDurably: async (key: string, value: string) => {
      kv.set(key, value)
    },
  }
  const service = new ConnectionsService(store, () => true, {
    spawn: spawnFake as unknown as typeof spawn,
    timeoutMs: 100,
  })
  const config = {
    id: 'local',
    name: 'Local MCP',
    enabled: false,
    transport: 'stdio',
    command: '/usr/bin/node',
    args: ['server.js', '--literal=$(do-not-run)'],
    env: { SERVICE_TOKEN: 'private-token' },
  }
  return { service, config, processes, spawnFake }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('MCP stdio transport', () => {
  it('uses shell-free argv, minimal inherited environment, JSON lines and explicit lifecycle', async () => {
    vi.stubEnv('UNRELATED_SECRET', 'must-not-inherit')
    const { service, config, spawnFake, processes } = setup()
    await service.save(config)
    expect(spawnFake).not.toHaveBeenCalled()
    await service.connect(config.id)
    expect(spawnFake).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['server.js', '--literal=$(do-not-run)'],
      expect.objectContaining({
        shell: false,
        stdio: 'pipe',
        windowsHide: true,
        env: expect.objectContaining({ SERVICE_TOKEN: 'private-token' }),
      }),
    )
    const options = spawnFake.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ]
    expect(options[2].env).not.toHaveProperty('UNRELATED_SECRET')
    const child = processes[0]!
    expect(child.sent.map((message) => message.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])
    expect(await service.call(service.tools()[0]!.id, { question: 'a\nb' })).toContain('a\\nb')
    await service.disconnect(config.id)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(service.tools()).toEqual([])
    await service.drain()
  })

  it('rejects server sampling and elicitation without advertising those capabilities', async () => {
    const { service, config, processes } = setup()
    await service.save(config)
    await service.connect(config.id)
    const child = processes[0]!
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'sampling/createMessage', id: 'sample', params: { secret: 'do not forward' } })}\n`,
    )
    await vi.waitFor(() => expect(child.sent.some((message) => message.id === 'sample')).toBe(true))
    expect(child.sent.find((message) => message.id === 'sample')).toMatchObject({
      error: { code: -32601 },
    })
    expect(child.sent[0]?.params).toMatchObject({ capabilities: {} })
    service.invalidate()
    await service.drain()
  })

  it('cancels an in-flight call once and ignores late results without re-executing it', async () => {
    const { service, config, processes } = setup((message) => message.method === 'tools/call')
    await service.save(config)
    await service.connect(config.id)
    const child = processes[0]!
    const controller = new AbortController()
    const pending = service.call(service.tools()[0]!.id, {}, controller.signal)
    const rejected = expect(pending).rejects.toThrow('external outcome may be unknown')
    controller.abort()
    await rejected
    const calls = child.sent.filter((message) => message.method === 'tools/call')
    expect(calls).toHaveLength(1)
    expect(
      child.sent.filter((message) => message.method === 'notifications/cancelled'),
    ).toHaveLength(1)
    child.respond(calls[0]!.id, { content: [{ type: 'text', text: 'too late' }] })
    expect((await service.list())[0]?.status).toBe('connected')
    service.invalidate()
    await service.drain()
  })

  it('bounds stalled calls by deadline without retrying them', async () => {
    const { service, config, processes } = setup((message) => message.method === 'tools/call')
    await service.save(config)
    await service.connect(config.id)
    // AbortSignal.timeout uses real timers, independently of Vitest fake timers.
    await expect(service.call(service.tools()[0]!.id, {})).rejects.toThrow('timed out')
    expect(processes[0]!.sent.filter((message) => message.method === 'tools/call')).toHaveLength(1)
    service.invalidate()
    await service.drain()
  })

  it.each(['malformed', 'oversized', 'exit', 'list-changed'])(
    'retires every descriptor after %s and releases pending requests',
    async (failure) => {
      const { service, config, processes } = setup((message) => message.method === 'tools/call')
      await service.save(config)
      await service.connect(config.id)
      const child = processes[0]!
      const pending = service.call(service.tools()[0]!.id, {})
      const rejected = expect(pending).rejects.toThrow()
      if (failure === 'malformed') child.stdout.write('diagnostic private-token is not JSON\n')
      if (failure === 'oversized') child.stdout.write('x'.repeat(LIMITS.messageBytes + 1))
      if (failure === 'exit') child.emit('close', 1)
      if (failure === 'list-changed')
        child.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n`,
        )
      await rejected
      expect(service.tools()).toEqual([])
      expect(JSON.stringify(await service.list())).not.toContain('private-token')
      await service.drain()
    },
  )

  it('forces termination when the server ignores graceful shutdown', async () => {
    vi.useFakeTimers()
    const { service, config, processes } = setup(undefined, true)
    await service.save(config)
    await service.connect(config.id)
    const disconnect = service.disconnect(config.id)
    await vi.advanceTimersByTimeAsync(1001)
    await disconnect
    expect(processes[0]!.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    await service.drain()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts initialization and stops the process on lock', async () => {
    const { service, config, processes } = setup((message) => message.method === 'initialize')
    await service.save(config)
    const connecting = service.connect(config.id)
    const rejected = expect(connecting).rejects.toThrow()
    await vi.waitFor(() => expect(processes).toHaveLength(1))
    service.invalidate()
    await rejected
    await service.drain()
    expect(processes[0]!.kill).toHaveBeenCalledWith('SIGTERM')
    expect(processes[0]!.sent.some((message) => message.method === 'notifications/cancelled')).toBe(
      false,
    )
    expect(service.tools()).toEqual([])
  })

  it('redacts secret values safely even when they contain JSON escape characters', async () => {
    const { service, config } = setup()
    const secret = 'abc"def\\ghi'
    const summary = await service.save({
      ...config,
      name: `Server ${secret}`,
      args: [`--token=${secret}`],
      env: { TOKEN: secret },
    })
    expect(summary.name).toBe('Server [redacted]')
    expect(summary.args).toEqual(['--token=[redacted]'])
    expect(summary.secretKeys).toEqual(['env:TOKEN'])
  })

  it.skipIf(subprocessDenied)(
    'initializes, calls and shuts down a real local Node subprocess',
    async () => {
      // A self-contained protocol fixture: no network, packages or user credentials.
      const script = `
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => {
        buffer += chunk;
        let split;
        while ((split = buffer.indexOf('\\n')) >= 0) {
          const message = JSON.parse(buffer.slice(0, split));
          buffer = buffer.slice(split + 1);
          if (!('id' in message)) continue;
          const result = message.method === 'initialize'
            ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'local-fixture', version: '1' } }
            : message.method === 'tools/list'
              ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
              : { content: [{ type: 'text', text: message.params.arguments.text }] };
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
        }
      });
    `
      const kv = new Map<string, string>()
      let child: ChildProcessWithoutNullStreams | undefined
      const launch = ((...args: Parameters<typeof spawn>) => {
        child = spawn(...args) as ChildProcessWithoutNullStreams
        return child
      }) as typeof spawn
      const service = new ConnectionsService(
        {
          getKv: (key) => kv.get(key) ?? null,
          setKvDurably: async (key, value) => {
            kv.set(key, value)
          },
        },
        () => true,
        { spawn: launch },
      )
      try {
        await service.save({
          id: 'smoke',
          name: 'Local smoke fixture',
          transport: 'stdio',
          enabled: false,
          command: process.execPath,
          args: ['-e', script],
        })
        expect(await service.connect('smoke')).toMatchObject({ status: 'connected', toolCount: 1 })
        expect(child?.pid).toBeTypeOf('number')
        expect(
          await service.call(service.tools()[0]!.id, { text: 'real pipe: Grüße\nnext line' }),
        ).toBe('real pipe: Grüße\nnext line')
        await service.disconnect('smoke')
        expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true)
        expect(service.tools()).toEqual([])
      } finally {
        service.invalidate()
        await service.drain()
      }
    },
  )
})
