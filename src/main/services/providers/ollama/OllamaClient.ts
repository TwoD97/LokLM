export type OllamaErrorKind = 'network' | 'timeout' | 'server' | 'client' | 'aborted'

export class OllamaError extends Error {
  constructor(
    public readonly kind: OllamaErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'OllamaError'
  }
}

export interface OllamaClientConfig {
  baseUrl: string
  bearerToken: string | null
  timeoutMs: number
}

const RETRYABLE_4XX = new Set([408, 429])

export class OllamaClient {
  constructor(private readonly cfg: OllamaClientConfig) {}

  async version(): Promise<string> {
    const res = await this.request('GET', '/api/version')
    const data = (await res.json()) as { version?: string }
    return data.version ?? 'unknown'
  }

  async listModels(): Promise<string[]> {
    const res = await this.request('GET', '/api/tags')
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    return (data.models ?? []).map((m) => m.name)
  }

  async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.request('POST', path, body, signal)
    return (await res.json()) as T
  }

  /**
   * Streams an NDJSON POST: each line is one JSON object.
   * Yields parsed objects until the stream ends or signal aborts.
   */
  async *postNdjson<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
    const res = await this.request('POST', path, body, signal, /* stream */ true)
    if (!res.body) throw new OllamaError('server', 'empty body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    try {
      while (true) {
        if (signal?.aborted) throw new OllamaError('aborted', 'aborted')
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line.length > 0) yield JSON.parse(line) as T
          nl = buf.indexOf('\n')
        }
      }
      const tail = buf.trim()
      if (tail.length > 0) yield JSON.parse(tail) as T
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* ignore */
      }
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    stream = false,
  ): Promise<Response> {
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + path
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.cfg.bearerToken) headers.Authorization = `Bearer ${this.cfg.bearerToken}`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort('timeout'), this.cfg.timeoutMs)
    const onUserAbort = (): void => ctrl.abort('user-cancel')
    if (signal) signal.addEventListener('abort', onUserAbort, { once: true })

    const init: RequestInit = { method, headers, signal: ctrl.signal }
    if (body !== undefined) init.body = JSON.stringify(body)

    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      const reason = ctrl.signal.reason
      if (reason === 'timeout')
        throw new OllamaError('timeout', `timeout after ${this.cfg.timeoutMs} ms`)
      if (reason === 'user-cancel') throw new OllamaError('aborted', 'cancelled')
      const code = (err as { code?: string }).code
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
        throw new OllamaError('network', `${code}`)
      }
      throw new OllamaError('network', err instanceof Error ? err.message : String(err))
    } finally {
      if (!stream) clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onUserAbort)
    }

    if (res.status >= 500) throw new OllamaError('server', `HTTP ${res.status}`, res.status)
    if (res.status >= 400 && !RETRYABLE_4XX.has(res.status)) {
      throw new OllamaError('client', `HTTP ${res.status}`, res.status)
    }
    if (res.status >= 400) throw new OllamaError('server', `HTTP ${res.status}`, res.status)
    return res
  }
}
