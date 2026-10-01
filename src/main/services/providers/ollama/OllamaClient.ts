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

interface PendingResponse {
  response: Response
  signal: AbortSignal
  close(): void
}

export class OllamaClient {
  constructor(private readonly cfg: OllamaClientConfig) {}

  async version(): Promise<string> {
    const data = await this.jsonRequest<{ version?: string }>('GET', '/api/version')
    return data.version ?? 'unknown'
  }

  async listModels(): Promise<string[]> {
    const data = await this.jsonRequest<{ models?: Array<{ name: string }> }>('GET', '/api/tags')
    return (data.models ?? []).map((m) => m.name)
  }

  async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.jsonRequest<T>('POST', path, body, signal)
  }

  /**
   * Streams an NDJSON POST: each line is one JSON object.
   * Yields parsed objects until the stream ends or signal aborts.
   */
  async *postNdjson<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
    const pending = await this.request('POST', path, body, signal)
    if (!pending.response.body) {
      pending.close()
      throw new OllamaError('server', 'empty body')
    }
    const reader = pending.response.body.getReader()
    // Cancelling the reader also releases a pending read when a test adapter or
    // proxy does not propagate fetch's abort signal into the response body.
    const cancelReader = (): void => {
      void reader.cancel().catch(() => undefined)
    }
    pending.signal.addEventListener('abort', cancelReader, { once: true })
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    try {
      while (true) {
        if (pending.signal.aborted) throw new OllamaError('aborted', 'cancelled')
        const { value, done } = await reader.read()
        if (pending.signal.aborted) throw new OllamaError('aborted', 'cancelled')
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          if (pending.signal.aborted) throw new OllamaError('aborted', 'cancelled')
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line.length > 0) yield JSON.parse(line) as T
          nl = buf.indexOf('\n')
        }
      }
      const tail = buf.trim()
      if (tail.length > 0) yield JSON.parse(tail) as T
    } catch (err) {
      if (pending.signal.aborted) throw new OllamaError('aborted', 'cancelled')
      throw err
    } finally {
      pending.signal.removeEventListener('abort', cancelReader)
      try {
        // A provider exits at the final NDJSON message, often before the HTTP
        // body closes. Release that body on both early return and cancellation.
        await reader.cancel().catch(() => undefined)
      } finally {
        reader.releaseLock()
        pending.close()
      }
    }
  }

  private async jsonRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const pending = await this.request(method, path, body, signal)
    try {
      return (await pending.response.json()) as T
    } catch (err) {
      if (pending.signal.aborted) throw new OllamaError('aborted', 'cancelled')
      throw err
    } finally {
      pending.close()
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<PendingResponse> {
    if (signal?.aborted) throw new OllamaError('aborted', 'cancelled')
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + path
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.cfg.bearerToken) headers.Authorization = `Bearer ${this.cfg.bearerToken}`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort('timeout'), this.cfg.timeoutMs)
    const onUserAbort = (): void => ctrl.abort('user-cancel')
    if (signal) signal.addEventListener('abort', onUserAbort, { once: true })
    const close = (): void => signal?.removeEventListener('abort', onUserAbort)

    // Consent applies to this configured endpoint. In particular, a loopback
    // 307/308 must never forward private prompts/documents to another origin.
    const init: RequestInit = { method, headers, signal: ctrl.signal, redirect: 'error' }
    if (body !== undefined) init.body = JSON.stringify(body)

    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      close()
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
      // This is a connection/header timeout. Slow generation is allowed to run
      // longer, while explicit cancellation stays wired until body consumption.
      clearTimeout(timer)
    }

    if (res.status >= 400) {
      close()
      void res.body?.cancel().catch(() => undefined)
      const kind = res.status < 500 && !RETRYABLE_4XX.has(res.status) ? 'client' : 'server'
      throw new OllamaError(kind, `HTTP ${res.status}`, res.status)
    }
    return { response: res, signal: ctrl.signal, close }
  }
}
