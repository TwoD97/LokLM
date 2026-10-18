import { randomUUID } from 'node:crypto'
import type {
  McpConnectionConfig,
  McpConnectionSummary,
  SkillTool,
} from '../../../shared/connections'
import { McpClient, type McpDependencies } from './McpClient'
import { NativeConnectorClient } from './NativeConnectorClient'
import {
  CONNECTIONS_KEY,
  LIMITS,
  McpError,
  connectionId,
  record,
  redact,
  safeError,
  validateConfig,
} from './validation'

interface ConnectionStore {
  getKv(key: string): string | null
  setKvDurably(key: string, value: string): Promise<void>
}
interface Runtime {
  controller: AbortController
  status: McpConnectionSummary['status']
  error?: string
  tools: SkillTool[]
  client?: Pick<McpClient, 'initialize' | 'request' | 'close'>
  connecting?: Promise<void>
}

/** Explicitly connected, account-scoped MCP servers. No tools execute on connect;
 * all discovered tools remain external actions requiring caller approval. */
export class ConnectionsService {
  private queue: Promise<void> = Promise.resolve()
  private runtimes = new Map<string, Runtime>()
  private closing = new Set<Promise<void>>()
  private invalidated = false

  constructor(
    private readonly store: ConnectionStore,
    private readonly isUnlocked: () => boolean,
    private readonly deps: McpDependencies = {},
  ) {}

  private assertActive(): void {
    if (this.invalidated || !this.isUnlocked())
      throw new McpError('MCP connections are locked. Unlock your account to continue.')
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {
      this.assertActive()
      return operation()
    })
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private configs(): McpConnectionConfig[] {
    this.assertActive()
    const raw = this.store.getKv(CONNECTIONS_KEY)
    if (raw === null) return []
    try {
      if (Buffer.byteLength(raw) > LIMITS.configBytes * LIMITS.connections) throw new Error('Size')
      const value = record(JSON.parse(raw))
      if (
        value.version !== 1 ||
        !Array.isArray(value.connections) ||
        value.connections.length > LIMITS.connections
      )
        throw new Error('Version')
      const configs = value.connections.map((config) => validateConfig(config))
      if (new Set(configs.map(({ id }) => id)).size !== configs.length) throw new Error('Duplicate')
      return configs
    } catch {
      throw new McpError('Saved MCP connections could not be read. No configuration was changed.')
    }
  }

  private async persist(configs: McpConnectionConfig[]): Promise<void> {
    this.assertActive()
    try {
      await this.store.setKvDurably(
        CONNECTIONS_KEY,
        JSON.stringify({ version: 1, connections: configs }),
      )
    } catch {
      throw new McpError(
        'MCP configuration could not be saved. Retry after checking vault storage.',
      )
    }
    this.assertActive()
  }

  private summary(config: McpConnectionConfig): McpConnectionSummary {
    const { env, headers, ...visible } = config
    const runtime = this.runtimes.get(config.id)
    // Known secret values must not leak even when repeated in names or arguments.
    const publicConfig = {
      ...visible,
      name: redact(visible.name, config),
      ...(visible.command !== undefined ? { command: redact(visible.command, config) } : {}),
      ...(visible.args !== undefined
        ? { args: visible.args.map((arg) => redact(arg, config)) }
        : {}),
      ...(visible.url !== undefined ? { url: redact(visible.url, config) } : {}),
    }
    return {
      ...publicConfig,
      secretKeys: [
        ...Object.keys(env ?? {}).map((key) => `env:${key}`),
        ...Object.keys(headers ?? {}).map((key) => `header:${key}`),
      ],
      status: runtime?.status ?? 'disconnected',
      ...(runtime?.error ? { error: redact(runtime.error, config) } : {}),
      toolCount: config.enabled ? (runtime?.tools.length ?? 0) : 0,
    }
  }

  list(): Promise<McpConnectionSummary[]> {
    return this.enqueue(async () => this.configs().map((config) => this.summary(config)))
  }

  save(input: unknown): Promise<McpConnectionSummary> {
    // Copy caller-owned fields before waiting behind another vault transaction.
    let copy: unknown
    try {
      copy = structuredClone(input)
    } catch {
      return Promise.reject(new McpError('Invalid MCP configuration.'))
    }
    return this.enqueue(async () => {
      const configs = this.configs()
      const id = connectionId(record(copy).id)
      const index = configs.findIndex((config) => config.id === id)
      const config = validateConfig(copy, configs[index])
      if (index < 0) {
        if (configs.length >= LIMITS.connections) throw new McpError('Too many MCP connections.')
        configs.push(config)
      } else configs[index] = config
      await this.persist(configs)
      await this.stop(id)
      this.runtimes.delete(id)
      return this.summary(config)
    })
  }

  remove(rawId: string): Promise<void> {
    const id = connectionId(rawId)
    return this.enqueue(async () => {
      const configs = this.configs()
      if (!configs.some((config) => config.id === id))
        throw new McpError('MCP connection was not found.')
      await this.stop(id)
      await this.persist(configs.filter((config) => config.id !== id))
      this.runtimes.delete(id)
    })
  }

  async connect(rawId: string, signal?: AbortSignal): Promise<McpConnectionSummary> {
    const id = connectionId(rawId)
    signal?.throwIfAborted()
    const admitted = await this.enqueue(async () => {
      signal?.throwIfAborted()
      const configs = this.configs()
      const config = configs.find((config) => config.id === id)
      if (!config) throw new McpError('MCP connection was not found.')
      if (!config.enabled) {
        config.enabled = true
        await this.persist(configs)
      }
      signal?.throwIfAborted()
      const existing = this.runtimes.get(id)
      if (existing && (existing.status === 'connected' || existing.status === 'connecting'))
        return { config, runtime: existing }
      await this.stop(id)
      this.assertActive()
      const runtime: Runtime = {
        controller: new AbortController(),
        status: 'connecting',
        tools: [],
      }
      this.runtimes.set(id, runtime)
      // Network work stays outside the mutation queue so disconnect/lock can abort it.
      runtime.connecting = this.open(config, runtime, signal)
      return { config, runtime }
    })
    await admitted.runtime.connecting
    this.assertActive()
    signal?.throwIfAborted()
    return this.summary(admitted.config)
  }

  private async open(
    config: McpConnectionConfig,
    runtime: Runtime,
    caller?: AbortSignal,
  ): Promise<void> {
    const signal = AbortSignal.any([
      runtime.controller.signal,
      ...(caller ? [caller] : []),
      AbortSignal.timeout(this.deps.connectTimeoutMs ?? 30_000),
    ])
    const nonce = randomUUID()
    try {
      const client =
        config.transport === 'fastmail' || config.transport === 'couchdb'
          ? new NativeConnectorClient(config, this.deps)
          : new McpClient(config, this.deps, () => {
              if (runtime.status === 'disconnected') return
              runtime.status = 'error'
              runtime.error =
                'MCP connection closed or its tools changed. Reconnect before using it.'
              runtime.tools = []
              runtime.controller.abort()
              this.trackClose(runtime.client?.close() ?? Promise.resolve())
            })
      runtime.client = client
      await client.initialize(signal)
      const discovered: SkillTool[] = []
      const seen = new Set<string>()
      const cursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < LIMITS.pages; page++) {
        const result = record(await client.request('tools/list', cursor ? { cursor } : {}, signal))
        if (!Array.isArray(result.tools))
          throw new McpError('MCP server returned an invalid tool list.')
        for (const raw of result.tools) {
          const tool = record(raw)
          if (
            typeof tool.name !== 'string' ||
            !tool.name ||
            tool.name.length > 128 ||
            [...tool.name].some((character) => character.charCodeAt(0) < 32) ||
            seen.has(tool.name)
          )
            throw new McpError('MCP server returned invalid or duplicate tool names.')
          if (
            tool.description !== undefined &&
            (typeof tool.description !== 'string' || tool.description.length > 16_000)
          )
            throw new McpError('MCP tool description exceeds the limit.')
          const schema = record(tool.inputSchema)
          if (
            schema.type !== 'object' ||
            Buffer.byteLength(JSON.stringify(schema)) > LIMITS.argumentsBytes
          )
            throw new McpError('MCP tool has an invalid or oversized input schema.')
          if (discovered.length >= LIMITS.tools)
            throw new McpError('MCP server exposes too many tools.')
          seen.add(tool.name)
          discovered.push({
            id: `mcp:${config.id}:${nonce}:${encodeURIComponent(tool.name)}`,
            name: tool.name,
            description: redact(String(tool.description ?? ''), config),
            inputSchema: schema,
            source:
              config.transport === 'fastmail' || config.transport === 'couchdb'
                ? 'connection'
                : 'mcp',
            connectionId: config.id,
            effect: 'external',
          })
        }
        if (result.nextCursor === undefined) {
          signal.throwIfAborted()
          this.assertActive()
          runtime.tools = discovered
          runtime.status = 'connected'
          delete runtime.error
          return
        }
        if (
          typeof result.nextCursor !== 'string' ||
          !result.nextCursor ||
          result.nextCursor.length > 4096 ||
          cursors.has(result.nextCursor)
        )
          throw new McpError('MCP tool pagination did not advance.')
        cursors.add(result.nextCursor)
        cursor = result.nextCursor
      }
      throw new McpError('MCP tool listing exceeded the page limit.')
    } catch (error) {
      runtime.tools = []
      if (runtime.status !== 'disconnected') {
        runtime.status = 'error'
        runtime.error ??= signal.aborted
          ? 'MCP connection was cancelled or timed out.'
          : safeError(error)
      }
      runtime.controller.abort()
      await this.trackClose(runtime.client?.close() ?? Promise.resolve())
      throw new McpError(redact(runtime.error ?? 'MCP connection was disconnected.', config))
    }
  }

  async disconnect(rawId: string): Promise<void> {
    const id = connectionId(rawId)
    this.assertActive()
    // Abort in-flight initialization immediately, even while a vault write is pending.
    const stopped = this.stop(id)
    await this.enqueue(async () => {
      const configs = this.configs()
      const config = configs.find((config) => config.id === id)
      if (!config) throw new McpError('MCP connection was not found.')
      config.enabled = false
      await this.persist(configs)
      await this.stop(id)
      await stopped
    })
  }

  tools(): SkillTool[] {
    if (this.invalidated || !this.isUnlocked()) return []
    return structuredClone(
      [...this.runtimes.values()].flatMap((runtime) =>
        runtime.status === 'connected' ? runtime.tools : [],
      ),
    )
  }

  async call(toolId: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    this.assertActive()
    signal?.throwIfAborted()
    const runtime = [...this.runtimes.values()].find(
      (runtime) =>
        runtime.status === 'connected' && runtime.tools.some((tool) => tool.id === toolId),
    )
    const tool = runtime?.tools.find((tool) => tool.id === toolId)
    if (!runtime?.client || !tool)
      throw new McpError('MCP tool is unavailable or changed. Reconnect and create a new proposal.')
    const config = this.configs().find(
      (config) => config.id === tool.connectionId && config.enabled,
    )
    if (!config) throw new McpError('MCP connection is disabled.')
    let captured: Record<string, unknown>
    try {
      const serialized = JSON.stringify(record(args))
      if (Buffer.byteLength(serialized) > LIMITS.argumentsBytes) throw new Error('Size')
      captured = record(JSON.parse(serialized))
    } catch {
      throw new McpError('MCP tool arguments are invalid or too large.')
    }
    const combined = AbortSignal.any([runtime.controller.signal, ...(signal ? [signal] : [])])
    try {
      const result = record(
        await runtime.client.request(
          'tools/call',
          { name: tool.name, arguments: captured },
          combined,
        ),
      )
      this.assertActive()
      combined.throwIfAborted()
      if (!Array.isArray(result.content)) throw new McpError('MCP tool returned an invalid result.')
      const chunks = result.content.flatMap((raw) => {
        const content = record(raw)
        if (content.type === 'text' && typeof content.text === 'string') return [content.text]
        if (content.type === 'resource' && content.resource) {
          const resource = record(content.resource)
          if (typeof resource.text === 'string') return [resource.text]
        }
        return [
          `[MCP ${typeof content.type === 'string' ? content.type.slice(0, 30) : 'non-text'} content omitted]`,
        ]
      })
      if (result.structuredContent !== undefined)
        chunks.push(JSON.stringify(result.structuredContent))
      const output = redact(chunks.join('\n'), config)
      if (output.length > LIMITS.resultChars)
        throw new McpError(
          'MCP tool result exceeds the text limit; request a smaller result. The call was not retried.',
        )
      if (result.isError === true)
        throw new McpError(
          `MCP tool reported an error: ${output.slice(0, 1000) || 'No details supplied.'}`,
        )
      return output || 'MCP tool completed without text output.'
    } catch (error) {
      throw new McpError(
        combined.aborted
          ? 'MCP request cancelled; its external outcome may be unknown. It was not retried.'
          : redact(safeError(error), config),
      )
    }
  }

  private trackClose(promise: Promise<void>): Promise<void> {
    this.closing.add(promise)
    void promise.then(
      () => this.closing.delete(promise),
      () => undefined,
    )
    // Keep rejected closures for drain(), but do not create unhandled rejections.
    void promise.catch(() => undefined)
    return promise
  }

  private stop(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (!runtime) return Promise.resolve()
    runtime.status = 'disconnected'
    runtime.tools = []
    delete runtime.error
    runtime.controller.abort()
    return this.trackClose(runtime.client?.close() ?? Promise.resolve())
  }

  invalidate(): void {
    this.invalidated = true
    for (const id of this.runtimes.keys()) void this.stop(id).catch(() => undefined)
  }

  async drain(): Promise<void> {
    await this.queue
    await Promise.all(
      [...this.runtimes.values()].map((runtime) => runtime.connecting?.catch(() => undefined)),
    )
    await Promise.all(this.closing)
  }
}
