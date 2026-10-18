import { McpError, record } from './validation'
import type { McpDependencies } from './McpClient'

/** Native connectors share bounded, cancellable HTTP. Credentials never follow redirects. */
export class NativeHttp {
  private controller = new AbortController()
  constructor(private readonly deps: McpDependencies) {}
  close(): Promise<void> {
    this.controller.abort()
    return Promise.resolve()
  }
  async json(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    body?: unknown,
    method?: 'PUT',
  ): Promise<Record<string, unknown>> {
    const combined = AbortSignal.any([
      signal,
      this.controller.signal,
      AbortSignal.timeout(this.deps.timeoutMs ?? 60000),
    ])
    combined.throwIfAborted()
    let response: Response
    try {
      response = await (this.deps.fetch ?? fetch)(url, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          ...headers,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined,
        redirect: 'error',
      })
    } catch {
      throw new McpError('Connection request failed or was cancelled. No request was retried.')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 409)
        throw new McpError(
          'The note changed since it was reviewed. Read the latest revision and review a new edit. Nothing was overwritten.',
        )
      throw new McpError(
        response.status === 401 || response.status === 403
          ? 'Authentication or permission denied. Check the connector credentials and account permissions.'
          : `Service returned HTTP ${response.status}. No request was retried.`,
      )
    }
    if (!response.body) throw new McpError('Service returned an empty response.')
    const reader = response.body.getReader()
    const abort = () => {
      void reader.cancel().catch(() => undefined)
    }
    combined.addEventListener('abort', abort, { once: true })
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        combined.throwIfAborted()
        const chunk = await reader.read()
        combined.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 2_000_000)
          throw new McpError('Service response is too large. Request a smaller page.')
        chunks.push(chunk.value)
      }
      try {
        return record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        throw new McpError('Service returned invalid JSON.')
      }
    } finally {
      combined.removeEventListener('abort', abort)
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
}

export type NativeTool = { name: string; description: string; inputSchema: Record<string, unknown> }
export function nativeTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): NativeTool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  }
}
export const idSchema = { type: 'string', minLength: 1, maxLength: 512 }
export const pageSchema = { type: 'integer', minimum: 1, maximum: 50 }

export interface NativeConnector {
  initialize(signal: AbortSignal): Promise<void>
  tools(): NativeTool[]
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  close(): Promise<void>
}
