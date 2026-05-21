import { useCallback, useEffect, useState } from 'react'

/** Shared auth-form state across LoginView / RegisterView / ResetView. The
 *  three views each used to track busy + error + a stale-rounded-minute
 *  cooldown text on their own ; this hook consolidates the bits that actually
 *  duplicate AND drives a live countdown for the rate_limited path (the old
 *  copy showed "5 Minuten warten" frozen until you remounted).
 *
 *  Returns:
 *   - `busy` / `setBusy` / `error` / `setError` for the trivial form state.
 *   - `cooldownMs` , remaining ms until the rate-limit lifts, or 0 when
 *     none. Polls itself every second so the message stays current.
 *   - `setCooldownUntil(absoluteMs | null)` , the IPC reply hands you
 *     `retryAfterMs`, you pass `Date.now() + retryAfterMs`.
 *   - `setRpcError(err)` , normalises the Electron IPC error prefix
 *     `"Error invoking remote method ipc:foo: Error: actual"` → `"actual"`. */
export interface UseAuthFormResult {
  busy: boolean
  error: string | null
  cooldownMs: number
  setBusy: (b: boolean) => void
  setError: (msg: string | null) => void
  setCooldownUntil: (untilMs: number | null) => void
  setRpcError: (err: unknown) => void
}

const RPC_PREFIX = /^Error invoking remote method [^:]+: Error: /

export function useAuthForm(): UseAuthFormResult {
  const [busy, setBusy] = useState(false)
  const [error, setErrorState] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntilState] = useState<number | null>(null)
  // Re-render tick so cooldownMs stays current. Only runs while a cooldown
  // is active — no idle interval when the user isn't rate-limited.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (cooldownUntil == null) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const cooldownMs = cooldownUntil == null ? 0 : Math.max(0, cooldownUntil - Date.now())

  // Auto-clear once the deadline passes so the next render computes 0
  // without leaving a stale `cooldownUntil` in state.
  useEffect(() => {
    if (cooldownUntil != null && cooldownMs === 0) setCooldownUntilState(null)
  }, [cooldownUntil, cooldownMs])

  const setError = useCallback((msg: string | null) => setErrorState(msg), [])
  const setCooldownUntil = useCallback((until: number | null) => setCooldownUntilState(until), [])
  const setRpcError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    setErrorState(msg.replace(RPC_PREFIX, ''))
  }, [])

  return { busy, error, cooldownMs, setBusy, setError, setCooldownUntil, setRpcError }
}

/** Pretty-print a cooldown remaining-time as "Xm Ys" (or just "Ys" under a
 *  minute). Common to the three views' rate-limit messages. */
export function formatCooldown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000)
  if (totalSec <= 0) return '0s'
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}
