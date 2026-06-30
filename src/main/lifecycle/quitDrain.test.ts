import { describe, it, expect } from 'vitest'
import { runQuitDrain, type QuitDrainDeps } from './quitDrain'

// Virtual-clock harness: `sleep` advances a synthetic clock instead of waiting,
// so the 30s/90s windows are exercised instantly and deterministically. The
// caller scripts isActive()/progressTicks() against the poll count.
function harness(opts: {
  isActive: (poll: number) => boolean
  ticks: (poll: number) => number
  pollMs?: number
  stallMs?: number
  maxMs?: number
}): { deps: QuitDrainDeps; polls: () => number } {
  let clock = 0
  let poll = 0
  const pollMs = opts.pollMs ?? 150
  const deps: QuitDrainDeps = {
    isActive: () => opts.isActive(poll),
    progressTicks: () => opts.ticks(poll),
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
      poll += 1
    },
    pollMs,
    stallMs: opts.stallMs ?? 30_000,
    maxMs: opts.maxMs ?? 90_000,
  }
  return { deps, polls: () => poll }
}

describe('runQuitDrain', () => {
  it('returns "idle" immediately when nothing is in flight', async () => {
    const { deps, polls } = harness({ isActive: () => false, ticks: () => 0 })
    expect(await runQuitDrain(deps)).toBe('idle')
    expect(polls()).toBe(0) // never slept
  })

  it('returns "drained" when the active work finishes on its own', async () => {
    // Active for the first 3 polls, then done; ticks advance so it never stalls.
    const { deps } = harness({
      isActive: (p) => p < 3,
      ticks: (p) => p,
    })
    expect(await runQuitDrain(deps)).toBe('drained')
  })

  it('returns "stalled" when progress freezes for the whole stall window', async () => {
    // Always active, ticks never move → stalls after stallMs of no progress.
    const { deps } = harness({
      isActive: () => true,
      ticks: () => 7, // frozen
      stallMs: 30_000,
      pollMs: 150,
    })
    expect(await runQuitDrain(deps)).toBe('stalled')
  })

  it('keeps waiting while progress advances (does NOT stall a slow-but-working drain)', async () => {
    // Ticks advance every poll for well past the stall window, then work finishes
    // before the ceiling → must NOT be reported as stalled.
    const finishAtPoll = 400 // 400 * 150ms = 60s of steady progress < 90s ceiling
    const { deps } = harness({
      isActive: (p) => p < finishAtPoll,
      ticks: (p) => p, // strictly increasing every poll
      stallMs: 30_000,
      maxMs: 90_000,
    })
    expect(await runQuitDrain(deps)).toBe('drained')
  })

  it('returns "ceiling" when a genuinely-progressing doc exceeds the absolute cap', async () => {
    // Always active, ticks always advancing (never stalls) → only the ceiling stops it.
    const { deps } = harness({
      isActive: () => true,
      ticks: (p) => p, // never stalls
      stallMs: 30_000,
      maxMs: 90_000,
    })
    expect(await runQuitDrain(deps)).toBe('ceiling')
  })

  it('a single late progress tick resets the stall clock', async () => {
    // No progress except one tick at poll 100; with stallMs=30s/poll=150ms the
    // stall threshold is 200 polls. The lone tick at 100 pushes the deadline out,
    // so the first stall can only fire at ~poll 300, not 200. Work ends at 250 →
    // the reset kept it alive, so it drains rather than stalling.
    const { deps } = harness({
      isActive: (p) => p < 250,
      ticks: (p) => (p < 100 ? 0 : 1), // exactly one bump at poll 100
      stallMs: 30_000,
      pollMs: 150,
      maxMs: 90_000,
    })
    expect(await runQuitDrain(deps)).toBe('drained')
  })
})
