type Scope =
  | 'chat'
  | 'quiz'
  | 'translation'
  | 'writing'
  | 'summary'
  | 'title'
  | 'export'
  | 'search'
  | 'read'
  | 'mutation'

/** Tracks window-owned inference requests across vault sessions. A late finally
 * from a retired session must never remove a newer request with the same ID. */
export class SessionRequests {
  private readonly requests = new Map<string, { scope: Scope; controller: AbortController }>()
  private epoch = 0

  /** Protect asynchronous login/settings initialization before it owns any
   * inference request. A later lock permanently retires this continuation. */
  captureSession(): () => boolean {
    const epoch = this.epoch
    return () => epoch === this.epoch
  }

  begin(scope: Scope, owner: number, id: string) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
      throw new Error('Invalid request ID')
    }
    const key = JSON.stringify([scope, owner, id])
    if (this.requests.has(key)) throw new Error('Request is already running')
    const entry = { scope, controller: new AbortController() }
    this.requests.set(key, entry)
    const isCurrent = (): boolean => this.requests.get(key) === entry
    return {
      controller: entry.controller,
      isCurrent,
      finish: (): void => {
        if (isCurrent()) this.requests.delete(key)
      },
    }
  }

  cancel(scope: Scope, owner: number, id: string): void {
    this.requests.get(JSON.stringify([scope, owner, id]))?.controller.abort()
  }

  has(scope: Scope): boolean {
    return [...this.requests.values()].some((entry) => entry.scope === scope)
  }

  reset(): void {
    this.epoch++
    const previous = [...this.requests.values()]
    this.requests.clear()
    for (const { controller } of previous) controller.abort()
  }
}
