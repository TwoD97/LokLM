// Opt-in retrieval trace channel (R-diagnostics). The main log file is capped
// at 'warn' (logger.ts FILE_LEVEL) — deliberately, it rotates at 5 MB and error
// spam already crowds it — so retrieval decisions (route, variants, candidates,
// floors, final slate) were never reconstructable post-hoc. This writes one
// JSON line per RetrievalService.search() call to a SEPARATE `retrieval.log`
// next to main.log.
//
// Enable with LOKLM_RETRIEVAL_TRACE=1. Outside electron (evals, unit tests) the
// target directory comes from LOKLM_RETRIEVAL_TRACE_DIR; with neither set the
// channel is a hard no-op. Privacy: callers log queries, chunk IDS and LENGTHS —
// never chunk text (the app's local-only promise extends to its logs).

import { appendFile } from 'node:fs/promises'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const TRACE_FILE = 'retrieval.log'
const TRACE_ROTATE_BYTES = 20_000_000

/** undefined = not resolved yet; null = disabled. */
let resolvedPath: string | null | undefined

function resolveTracePath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath
  if (process.env['LOKLM_RETRIEVAL_TRACE'] !== '1') {
    resolvedPath = null
    return null
  }
  let dir = process.env['LOKLM_RETRIEVAL_TRACE_DIR'] ?? null
  if (!dir) {
    try {
      const localRequire = createRequire(import.meta.url)
      const { app } = localRequire('electron') as { app?: { getPath: (n: string) => string } }
      dir = app?.getPath('logs') ?? null
    } catch {
      dir = null
    }
  }
  if (!dir) {
    resolvedPath = null
    return null
  }
  const path = join(dir, TRACE_FILE)
  try {
    // The logs dir may not exist yet on a fresh profile (electron creates it
    // lazily) — without this the whole channel silently no-ops.
    mkdirSync(dir, { recursive: true })
    // One-shot rotation at startup — a trace file is a debugging artefact, one
    // generation of history is enough.
    if (existsSync(path) && statSync(path).size > TRACE_ROTATE_BYTES) {
      renameSync(path, join(dir, 'retrieval.old.log'))
    }
  } catch {
    // rotation is best-effort; appends below still work (or fail silently).
  }
  resolvedPath = path
  return path
}

/**
 * Append one trace event as a JSON line. Takes a THUNK so callers pay zero
 * object-building cost when tracing is off. Fire-and-forget + fully swallowed:
 * a trace failure must never surface into the retrieval pipeline.
 */
export function retrievalTrace(build: () => Record<string, unknown>): void {
  const path = resolveTracePath()
  if (!path) return
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...build() })
    void appendFile(path, line + '\n', 'utf8').catch(() => {})
  } catch {
    // JSON.stringify edge cases (circular refs) — drop the event, never throw.
  }
}

/** Test hook: forget the resolved path so env changes take effect. */
export function __resetRetrievalTraceForTest(): void {
  resolvedPath = undefined
}
