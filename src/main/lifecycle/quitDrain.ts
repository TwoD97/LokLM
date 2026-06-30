// Pure, dependency-injected core of the app-quit indexing drain. Extracted from
// main/index.ts so the stall/ceiling/progress decision — the subtlest part of
// the quit path — is unit-testable without Electron or a real clock. index.ts
// wires the real services + Date.now + setTimeout into it.

export interface QuitDrainDeps {
  /** True while indexing/backfill is still doing work in a worker. */
  isActive: () => boolean
  /** Monotonic counter that advances once per embedded batch (liveness signal). */
  progressTicks: () => number
  /** Wall-clock reader (Date.now in prod; a virtual clock in tests). */
  now: () => number
  /** Resolves after roughly `ms` (setTimeout in prod; advances the clock in tests). */
  sleep: (ms: number) => Promise<void>
  /** Poll interval between liveness checks. */
  pollMs: number
  /** Give up after this long with zero forward progress (a wedged worker). */
  stallMs: number
  /** Absolute ceiling on the whole drain, even while progressing (perceived-hang bound). */
  maxMs: number
}

export type QuitDrainOutcome =
  /** Nothing was in flight — returned immediately. */
  | 'idle'
  /** All in-flight work finished on its own. */
  | 'drained'
  /** No progress for the stall window — treated as wedged. */
  | 'stalled'
  /** Hit the absolute time ceiling while still (or no longer) progressing. */
  | 'ceiling'

/**
 * Waits for in-flight indexing to settle, returning WHY it stopped. Waits as
 * long as the progress counter keeps advancing (so a slow-but-working
 * book-length document finishes), bailing only on a stall or the absolute
 * ceiling. Caller is responsible for first quiescing the queue / cancelling the
 * backfill so `isActive` actually converges.
 */
export async function runQuitDrain(deps: QuitDrainDeps): Promise<QuitDrainOutcome> {
  if (!deps.isActive()) return 'idle'
  const startedAt = deps.now()
  let lastTicks = deps.progressTicks()
  let lastProgressAt = startedAt
  while (deps.isActive()) {
    await deps.sleep(deps.pollMs)
    const now = deps.now()
    const ticks = deps.progressTicks()
    if (ticks !== lastTicks) {
      lastTicks = ticks
      lastProgressAt = now
    }
    if (now - startedAt >= deps.maxMs) return 'ceiling'
    if (now - lastProgressAt >= deps.stallMs) return 'stalled'
  }
  return 'drained'
}
