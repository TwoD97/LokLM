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

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new OllamaError('server', 'Invalid JSON in Ollama response')
  }
}

// Also bound custom response bodies that do not react to fetch's AbortSignal.
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(signal.aborted ? signal.reason : error)
      },
    )
    if (signal.aborted) {
      signal.removeEventListener('abort', onAbort)
      onAbort()
    }
  })
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
   * The timeout bounds each pending read, not total generation or consumer time.
   */
  async *postNdjson<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    for await (const value of this.responseChunks('POST', path, body, signal, true)) {
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        if (signal?.aborted) throw new OllamaError('aborted', 'cancelled')
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line.length > 0) yield parseJson<T>(line)
        nl = buf.indexOf('\n')
      }
    }
    const tail = (buf + decoder.decode()).trim()
    if (signal?.aborted) throw new OllamaError('aborted', 'cancelled')
    if (tail.length > 0) yield parseJson<T>(tail)
  }

  private async jsonRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const decoder = new TextDecoder('utf-8')
    let text = ''
    for await (const value of this.responseChunks(method, path, body, signal)) {
      text += decoder.decode(value, { stream: true })
    }
    return parseJson<T>(text + decoder.decode())
  }

  private async *responseChunks(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    streaming = false,
  ): AsyncGenerator<Uint8Array> {
    if (signal?.aborted) throw new OllamaError('aborted', 'cancelled')
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + path
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.cfg.bearerToken) headers.Authorization = `Bearer ${this.cfg.bearerToken}`

    const ctrl = new AbortController()
    // Consent applies to this configured endpoint. In particular, a loopback
    // 307/308 must never forward private prompts/documents to another origin.
    const init: RequestInit = { method, headers, signal: ctrl.signal, redirect: 'error' }
    try {
      if (body !== undefined) init.body = JSON.stringify(body)
    } catch {
      throw new OllamaError('client', 'Request body cannot be serialized as JSON')
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const startTimer = (): void => {
      clearTimeout(timer)
      timer = setTimeout(
        () => ctrl.abort(new OllamaError('timeout', `timeout after ${this.cfg.timeoutMs} ms`)),
        this.cfg.timeoutMs,
      )
    }
    const onUserAbort = (): void => ctrl.abort(new OllamaError('aborted', 'cancelled'))
    signal?.addEventListener('abort', onUserAbort, { once: true })
    if (signal?.aborted) onUserAbort()

    let res: Response | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancelReader = (): void => {
      if (reader) void reader.cancel().catch(() => {})
    }
    let complete = false
    try {
      if (ctrl.signal.aborted) throw ctrl.signal.reason
      startTimer()
      res = await abortable<Response>(
        fetch(url, init).then((response) => {
          if (ctrl.signal.aborted) {
            if (response.body) void response.body.cancel().catch(() => {})
            throw ctrl.signal.reason
          }
          return response
        }),
        ctrl.signal,
      )
      if (res.status >= 400) {
        const kind = res.status >= 500 || RETRYABLE_4XX.has(res.status) ? 'server' : 'client'
        throw new OllamaError(kind, `HTTP ${res.status}`, res.status)
      }
      if (!res.body) throw new OllamaError('server', 'empty body')
      reader = res.body.getReader()
      // Release adapters that do not propagate fetch's signal to the body,
      // even while the consumer is paused at a yielded record.
      ctrl.signal.addEventListener('abort', cancelReader, { once: true })
      while (true) {
        if (ctrl.signal.aborted) throw ctrl.signal.reason
        if (streaming) startTimer()
        const { value, done } = await abortable(reader.read(), ctrl.signal)
        // Backpressure from the consumer is not a stalled connection.
        if (streaming) clearTimeout(timer)
        if (done) {
          complete = true
          break
        }
        yield value
      }
    } catch (err) {
      if (ctrl.signal.aborted) throw ctrl.signal.reason
      if (err instanceof OllamaError) throw err
      const code = (err as { code?: string } | null)?.code
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
        throw new OllamaError('network', code)
      }
      throw new OllamaError('network', err instanceof Error ? err.message : String(err))
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onUserAbort)
      ctrl.signal.removeEventListener('abort', cancelReader)
      if (!complete) {
        // Do not wait on a remote/custom body's potentially stalled cancel hook.
        if (reader) void reader.cancel().catch(() => {})
        else if (res?.body) void res.body.cancel().catch(() => {})
      }
      reader?.releaseLock()
    }
  }
}
