import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { version as appVersion } from '../../../../package.json'
import type { McpConnectionConfig } from '../../../shared/connections'
import { LIMITS, McpError, record } from './validation'

export interface McpDependencies {
  fetch?: typeof fetch
  spawn?: typeof spawn
  timeoutMs?: number
  connectTimeoutMs?: number
}
type Message = Record<string, unknown>
const VERSION = '2025-11-25'
const SUPPORTED = new Set([VERSION, '2025-06-18', '2025-03-26'])

interface Wire {
  request(message: Message, signal: AbortSignal): Promise<unknown>
  notify(message: Message, signal?: AbortSignal): Promise<void>
  close(): Promise<void>
  version: string
}

function reply(message: Message): unknown {
  const hasResult = 'result' in message
  const hasError = 'error' in message
  if (message.jsonrpc !== '2.0' || hasResult === hasError)
    throw new McpError('MCP server returned an invalid response.')
  if ('error' in message) throw new McpError('MCP server rejected the request.')
  return message.result
}

function serverReply(message: Message): Message | null {
  if (typeof message.method !== 'string' || !('id' in message)) return null
  return message.method === 'ping'
    ? { jsonrpc: '2.0', id: message.id, result: {} }
    : {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Client capability not supported.' },
      }
}

class StdioWire implements Wire {
  version = VERSION
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<
    unknown,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private buffer = ''
  private closed = false
  private exited = false
  private stopped: Promise<void> | null = null

  constructor(
    config: McpConnectionConfig,
    deps: McpDependencies,
    private readonly failed: () => void,
  ) {
    const env: NodeJS.ProcessEnv = {}
    for (const key of [
      'PATH',
      'HOME',
      'USERPROFILE',
      'TMP',
      'TEMP',
      'TMPDIR',
      'SystemRoot',
      'SYSTEMROOT',
      'WINDIR',
    ])
      if (process.env[key] !== undefined) env[key] = process.env[key]
    this.child = (deps.spawn ?? spawn)(config.command!, config.args ?? [], {
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
      env: { ...env, ...config.env },
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      if (this.closed) return
      this.buffer += chunk
      if (Buffer.byteLength(this.buffer) > LIMITS.messageBytes) {
        this.fail()
        return
      }
      let split: number
      while ((split = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, split).trim()
        this.buffer = this.buffer.slice(split + 1)
        if (!line) continue
        try {
          const message = record(JSON.parse(line))
          if (message.jsonrpc !== '2.0') throw new Error('Invalid RPC')
          if (message.method === 'notifications/tools/list_changed') {
            this.fail()
            return
          }
          const response = serverReply(message)
          if (response) {
            void this.notify(response).catch(() => this.fail())
            continue
          }
          if (typeof message.method === 'string') continue
          const pending = this.pending.get(message.id)
          if (!pending) continue
          this.pending.delete(message.id)
          try {
            pending.resolve(reply(message))
          } catch (error) {
            pending.reject(error as Error)
          }
        } catch {
          this.fail()
          return
        }
      }
    })
    // Drain diagnostics without retaining or logging server credentials.
    this.child.stderr.resume()
    this.child.stdin.on('error', () => this.fail())
    this.child.on('error', () => this.fail())
    this.child.once('close', () => {
      this.exited = true
      this.fail()
    })
    this.child.on('spawn', () => {
      if (this.closed) this.child.kill('SIGTERM')
    })
  }

  private fail(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values())
      pending.reject(
        new McpError('MCP server disconnected or sent invalid data. Reconnect before retrying.'),
      )
    this.pending.clear()
    this.buffer = ''
    this.failed()
    void this.close().catch(() => undefined)
  }

  request(message: Message, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (this.closed) return Promise.reject(new McpError('MCP connection is closed.'))
    if (this.pending.size >= 8)
      return Promise.reject(new McpError('Too many MCP requests are running.'))
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.pending.delete(message.id)
        if (message.method !== 'initialize')
          void this.notify({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: message.id, reason: 'Request cancelled' },
          }).catch(() => undefined)
        reject(
          new McpError('MCP request cancelled or timed out; its external outcome may be unknown.'),
        )
      }
      const finish = (work: () => void): void => {
        signal.removeEventListener('abort', abort)
        work()
      }
      this.pending.set(message.id, {
        resolve: (value) => finish(() => resolve(value)),
        reject: (error) => finish(() => reject(error)),
      })
      signal.addEventListener('abort', abort, { once: true })
      void this.notify(message).catch(() => this.fail())
    })
  }

  notify(message: Message): Promise<void> {
    if (this.closed) return Promise.reject(new McpError('MCP connection is closed.'))
    return new Promise((resolve, reject) =>
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) =>
        error ? reject(new McpError('MCP server input failed.')) : resolve(),
      ),
    )
  }

  close(): Promise<void> {
    if (this.stopped) return this.stopped
    this.closed = true
    for (const pending of this.pending.values())
      pending.reject(new McpError('MCP connection is closed.'))
    this.pending.clear()
    this.buffer = ''
    if (this.exited) return Promise.resolve()
    this.stopped = new Promise<void>((resolve, reject) => {
      const done = (): void => {
        clearTimeout(force)
        clearTimeout(deadline)
        resolve()
      }
      this.child.once('close', done)
      const force = setTimeout(() => this.child.kill('SIGKILL'), 1000)
      const deadline = setTimeout(() => {
        this.child.removeListener('close', done)
        reject(new McpError('MCP subprocess could not be stopped.'))
      }, 2500)
      this.child.stdin.destroy()
      this.child.kill('SIGTERM')
    })
    return this.stopped
  }
}

class HttpWire implements Wire {
  version = VERSION
  private session: string | null = null
  private closed = false
  private active = new Set<AbortController>()
  private stopped: Promise<void> | null = null
  constructor(
    private readonly config: McpConnectionConfig,
    private readonly deps: McpDependencies,
    private readonly failed: () => void,
  ) {}

  private headers(): Record<string, string> {
    return {
      ...this.config.headers,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': this.version,
      ...(this.session ? { 'MCP-Session-Id': this.session } : {}),
    }
  }

  private async post(message: Message, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (this.closed) throw new McpError('MCP connection is closed.')
    const controller = new AbortController()
    this.active.add(controller)
    const combined = AbortSignal.any([signal, controller.signal])
    try {
      const response = await (this.deps.fetch ?? fetch)(this.config.url!, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(message),
        redirect: 'error',
        signal: combined,
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        if (response.status === 404 && this.session) this.failed()
        throw new McpError(
          response.status === 401 || response.status === 403
            ? 'MCP authentication failed. Configure the server credentials.'
            : `MCP server returned HTTP ${response.status}.`,
        )
      }
      if (message.method === 'initialize') {
        const session = response.headers.get('mcp-session-id')
        if (session !== null && !/^[\x21-\x7e]{1,1024}$/.test(session)) {
          void response.body?.cancel().catch(() => undefined)
          throw new McpError('MCP server returned an invalid session ID.')
        }
        this.session = session
      }
      if (!('id' in message) || !('method' in message)) {
        void response.body?.cancel().catch(() => undefined)
        if (response.status !== 202)
          throw new McpError('MCP server did not acknowledge the notification.')
        return undefined
      }
      if (!response.body) throw new McpError('MCP server returned no response body.')
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (type !== 'application/json' && type !== 'text/event-stream') {
        void response.body.cancel().catch(() => undefined)
        throw new McpError('MCP server returned an unsupported content type.')
      }
      const reader = response.body.getReader()
      const abortReader = (): void => {
        void reader.cancel().catch(() => undefined)
      }
      combined.addEventListener('abort', abortReader, { once: true })
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let bytes = 0
      let text = ''
      let data: string[] = []
      let skipLf = false
      const handle = async (raw: string): Promise<{ result: unknown } | null> => {
        const incoming = record(JSON.parse(raw))
        if (incoming.jsonrpc !== '2.0')
          throw new McpError('MCP server returned an invalid response.')
        if (incoming.method === 'notifications/tools/list_changed') {
          this.failed()
          throw new McpError('MCP tools changed. Reconnect to refresh them.')
        }
        const responseMessage = serverReply(incoming)
        if (responseMessage) {
          await this.post(responseMessage, combined)
          return null
        }
        if (typeof incoming.method === 'string') return null
        if (incoming.id !== message.id)
          throw new McpError('MCP server returned an unmatched response.')
        return { result: reply(incoming) }
      }
      try {
        while (true) {
          combined.throwIfAborted()
          const chunk = await reader.read()
          combined.throwIfAborted()
          bytes += chunk.value?.byteLength ?? 0
          if (bytes > LIMITS.messageBytes)
            throw new McpError('MCP response exceeds the size limit.')
          text += decoder.decode(chunk.value, { stream: !chunk.done })
          if (type === 'text/event-stream') {
            while (text.length > 0) {
              if (skipLf) {
                if (text.startsWith('\n')) text = text.slice(1)
                skipLf = false
              }
              const split = text.search(/[\r\n]/)
              if (split < 0) break
              const line = text.slice(0, split)
              skipLf = text[split] === '\r'
              text = text.slice(split + 1)
              if (!line) {
                if (data.length) {
                  const event = data.join('\n')
                  data = []
                  if (event.trim()) {
                    const found = await handle(event)
                    if (found) return found.result
                  }
                }
              } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
            }
          }
          if (chunk.done) break
        }
        if (type === 'application/json') {
          const found = await handle(text)
          if (found) return found.result
        }
        throw new McpError('MCP response ended before completion. The request was not retried.')
      } finally {
        combined.removeEventListener('abort', abortReader)
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    } finally {
      this.active.delete(controller)
    }
  }

  async request(message: Message, signal: AbortSignal): Promise<unknown> {
    try {
      return await this.post(message, signal)
    } catch (error) {
      if (signal.aborted && message.method !== 'initialize')
        void this.notify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: message.id, reason: 'Request cancelled' },
        }).catch(() => undefined)
      throw error
    }
  }

  async notify(message: Message, signal?: AbortSignal): Promise<void> {
    await this.post(
      message,
      AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(this.deps.timeoutMs ?? 60_000),
      ]),
    )
  }

  close(): Promise<void> {
    if (this.stopped) return this.stopped
    this.closed = true
    for (const controller of this.active) controller.abort()
    const session = this.session
    this.session = null
    this.stopped = session
      ? (this.deps.fetch ?? fetch)(this.config.url!, {
          method: 'DELETE',
          headers: { ...this.headers(), 'MCP-Session-Id': session },
          redirect: 'error',
          signal: AbortSignal.timeout(2500),
        })
          .then(async (response) => {
            await response.body?.cancel()
          })
          .catch(() => undefined)
      : Promise.resolve()
    return this.stopped
  }
}

export class McpClient {
  private wire: Wire
  private sequence = 0
  private activeRequests = 0
  constructor(
    config: McpConnectionConfig,
    private readonly deps: McpDependencies,
    failed: () => void,
  ) {
    this.wire =
      config.transport === 'stdio'
        ? new StdioWire(config, deps, failed)
        : new HttpWire(config, deps, failed)
  }
  async initialize(signal: AbortSignal): Promise<void> {
    const result = record(
      await this.request(
        'initialize',
        {
          protocolVersion: VERSION,
          capabilities: {},
          clientInfo: { name: 'LokLM', version: appVersion },
        },
        signal,
      ),
    )
    if (typeof result.protocolVersion !== 'string' || !SUPPORTED.has(result.protocolVersion))
      throw new McpError('MCP server selected an unsupported protocol version.')
    if (!record(result.capabilities).tools)
      throw new McpError('This MCP server does not expose tools.')
    this.wire.version = result.protocolVersion
    signal.throwIfAborted()
    await this.wire.notify({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal)
    signal.throwIfAborted()
  }
  async request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.activeRequests >= 8) throw new McpError('Too many MCP requests are running.')
    this.activeRequests++
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.deps.timeoutMs ?? 60_000)])
    try {
      return await this.wire.request(
        { jsonrpc: '2.0', id: ++this.sequence, method, params },
        combined,
      )
    } catch (error) {
      if (combined.aborted)
        throw new McpError(
          'MCP request cancelled or timed out; its external outcome may be unknown. It was not retried.',
        )
      throw error
    } finally {
      this.activeRequests--
    }
  }
  close(): Promise<void> {
    return this.wire.close()
  }
}
