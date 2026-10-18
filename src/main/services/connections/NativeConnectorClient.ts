import type { McpConnectionConfig } from '../../../shared/connections'
import type { McpDependencies } from './McpClient'
import { FastmailConnector } from './FastmailConnector'
import { CouchDbConnector } from './CouchDbConnector'
import { McpError, record } from './validation'
import { validateToolArguments } from '../skills/validateToolArguments'
import type { NativeConnector } from './nativeHttp'

/** Internal adapter to the existing discovery/review lifecycle; no MCP server required. */
export class NativeConnectorClient {
  private connector: NativeConnector
  private busy = false
  private timeoutMs: number
  constructor(config: McpConnectionConfig, deps: McpDependencies) {
    this.timeoutMs = deps.timeoutMs ?? 60000
    this.connector =
      config.transport === 'fastmail'
        ? new FastmailConnector(config, deps)
        : new CouchDbConnector(config, deps)
  }
  initialize(signal: AbortSignal): Promise<void> {
    return this.connector.initialize(signal)
  }
  close(): Promise<void> {
    return this.connector.close()
  }
  async request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted()
    if (method === 'tools/list') return { tools: this.connector.tools() }
    if (method !== 'tools/call') throw new McpError('Unsupported connector operation.')
    const tool = this.connector.tools().find((tool) => tool.name === params.name)
    if (!tool) throw new McpError('Unknown connector tool.')
    const args = record(params.arguments)
    validateToolArguments(tool.inputSchema, args)
    if (this.busy)
      throw new McpError('This connection is busy. Wait for its current action to finish.')
    this.busy = true
    try {
      const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      const result = await this.connector.call(tool.name, args, combined)
      combined.throwIfAborted()
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } finally {
      this.busy = false
    }
  }
}
