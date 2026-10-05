/** Session-local cache of query vectors, never source hits or text.
 * Cancellation detaches one consumer without canceling another caller sharing
 * the same in-flight vector. The last consumer cancels the provider operation;
 * native providers still finish their current batch before releasing it. */
export class QueryEmbeddingCache {
  private readonly entries = new Map<string, Float32Array>()
  private readonly pending = new Map<
    string,
    {
      promise: Promise<Float32Array | null>
      consumers: Set<symbol>
      controller: AbortController
    }
  >()
  private bytes = 0
  private epoch = 0
  private scope: object | null = null
  private hits = 0
  private misses = 0
  private coalesced = 0

  constructor(
    private readonly maxEntries = 128,
    private readonly maxBytes = 1024 * 1024,
    private readonly maxPending = 16,
  ) {}

  useProvider(provider: object): void {
    if (this.scope === provider) return
    this.scope = provider
    this.epoch++
    this.entries.clear()
    this.pending.clear()
    this.bytes = 0
  }

  snapshot(): Record<string, number | boolean> {
    return {
      enabled: true,
      entries: this.entries.size,
      bytes: this.bytes,
      pending: this.pending.size,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
    }
  }

  async get(
    key: string,
    compute: (signal: AbortSignal) => Promise<Float32Array | null>,
    signal?: AbortSignal,
  ): Promise<Float32Array | null> {
    signal?.throwIfAborted()
    const cached = this.entries.get(key)
    if (cached) {
      this.hits++
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached.slice()
    }
    let pending = this.pending.get(key)
    if (pending) this.coalesced++
    else {
      this.misses++
      // Overflow work stays uncached, but still gets the same cancellation
      // boundary as a shared entry. A full map must not make Stop wait for a
      // native result or dispatch work canceled before its first microtask.
      const cacheable = this.pending.size < this.maxPending
      const epoch = this.epoch
      const consumers = new Set<symbol>()
      const controller = new AbortController()
      // Defer compute until the first consumer has registered. This also turns
      // a synchronous provider failure into the same rejected-promise path.
      const entry = {
        consumers,
        controller,
        promise: Promise.resolve()
          .then(() => (consumers.size > 0 ? compute(controller.signal) : null))
          .then((vector) => {
            if (cacheable && epoch === this.epoch && consumers.size > 0 && vector)
              this.put(key, vector)
            return vector
          }),
      }
      pending = entry
      if (cacheable) this.pending.set(key, entry)
      void entry.promise
        .finally(() => {
          if (this.pending.get(key) === entry) this.pending.delete(key)
        })
        .catch(() => {})
    }
    const consumer = Symbol()
    pending.consumers.add(consumer)
    let onAbort: (() => void) | undefined
    const canceled = new Promise<never>((_resolve, reject) => {
      if (!signal) return
      onAbort = () => {
        pending.consumers.delete(consumer)
        if (pending.consumers.size === 0) {
          if (this.pending.get(key) === pending) this.pending.delete(key)
          pending.controller.abort(signal.reason)
        }
        reject(signal.reason)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const vector = await Promise.race([pending.promise, canceled])
      signal?.throwIfAborted()
      return vector?.slice() ?? null
    } finally {
      pending.consumers.delete(consumer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
  }

  private put(key: string, vector: Float32Array): void {
    if (
      vector.length === 0 ||
      vector.byteLength > this.maxBytes ||
      this.maxEntries <= 0 ||
      !vector.every(Number.isFinite)
    )
      return
    const previous = this.entries.get(key)
    if (previous) {
      this.bytes -= previous.byteLength
      this.entries.delete(key)
    }
    this.entries.set(key, vector.slice())
    this.bytes += vector.byteLength
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!
      this.bytes -= this.entries.get(oldest)!.byteLength
      this.entries.delete(oldest)
    }
  }
}
