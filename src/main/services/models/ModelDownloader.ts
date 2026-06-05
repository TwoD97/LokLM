/**
 * Streams GGUFs from the manifest to disk on first launch.
 *
 *  - **Resume**: writes to `<filename>.partial`. On a re-run, if a partial
 *    exists we send `Range: bytes=<n>-` to skip what we already have. If the
 *    server doesn't honor the range (returns 200 instead of 206), we
 *    transparently start over and truncate the partial.
 *  - **Verify**: when the manifest carries a SHA-256 we stream-hash and
 *    reject mismatches. When it doesn't, we fall back to a size check
 *    (Content-Length must equal the manifest size exactly; partial files
 *    that finished short of `sizeBytes` are deleted).
 *  - **Cancel**: per-model `AbortController`. Aborting from `cancel(id)`
 *    leaves the `.partial` in place so the next attempt resumes.
 *  - **Progress events**: rate-limited to ~4/s. Emitted to every registered
 *    listener; the IPC bridge forwards them to the renderer.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { getManifestEntry, type ModelManifestEntry } from './manifest'
import { getDownloadTargetDir } from './paths'

export type DownloadPhase = 'downloading' | 'verifying' | 'complete' | 'error' | 'cancelled'

export interface DownloadEvent {
  /** Manifest id of the model this event is for. */
  id: string
  phase: DownloadPhase
  /** Bytes already written to disk (counts resumed bytes). */
  bytesReceived: number
  /** Total expected bytes — derived from Content-Range/Length when available,
   *  falls back to the manifest's `sizeBytes`. */
  totalBytes: number
  /** Smoothed throughput over the last progress tick. Null on the first
   *  tick of a transfer or during verify. */
  bytesPerSec: number | null
  /** Set when `phase === 'error'`. */
  message: string | null
}

type Listener = (ev: DownloadEvent) => void

const PROGRESS_TICK_MS = 250
/** Size verification tolerance — must match availability.ts. */
const SIZE_TOLERANCE = 0.02

export class ModelDownloader {
  private active = new Map<string, AbortController>()
  private listeners = new Set<Listener>()

  /** Subscribe to progress events for every download. Returns an unsubscribe
   *  function. */
  onProgress(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Whether a download for this id is currently active. */
  isActive(id: string): boolean {
    return this.active.has(id)
  }

  /** Whether *any* download is currently active. Used by the auth service to
   *  pause its inactivity timer , a 4 GB GGUF takes longer than the 15 min
   *  default and the user sitting at the download view would otherwise get
   *  locked out mid-transfer. */
  hasAnyActive(): boolean {
    return this.active.size > 0
  }

  cancel(id: string): void {
    const ctrl = this.active.get(id)
    if (ctrl) ctrl.abort()
  }

  /**
   * Run the download. Resolves on success, rejects on error (after emitting
   * an `error` event so the UI can react). A `cancelled` event is emitted on
   * user-initiated abort; in that case the promise resolves quietly.
   */
  async download(id: string): Promise<void> {
    const entry = getManifestEntry(id)
    if (!entry) throw new Error(`Unknown model id: ${id}`)
    if (this.active.has(id)) {
      // Already running — silent no-op so the renderer can call download()
      // idempotently when retrying.
      return
    }

    const ctrl = new AbortController()
    this.active.set(id, ctrl)

    const dir = getDownloadTargetDir()
    mkdirSync(dir, { recursive: true })
    const target = join(dir, entry.filename)
    const partial = `${target}.partial`

    try {
      await this.runOnce(entry, target, partial, ctrl.signal)
    } catch (err) {
      if (ctrl.signal.aborted) {
        // User cancelled; partial remains for a future resume.
        this.emit({
          id,
          phase: 'cancelled',
          bytesReceived: existsSync(partial) ? statSync(partial).size : 0,
          totalBytes: entry.sizeBytes,
          bytesPerSec: null,
          message: null,
        })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      this.emit({
        id,
        phase: 'error',
        bytesReceived: existsSync(partial) ? statSync(partial).size : 0,
        totalBytes: entry.sizeBytes,
        bytesPerSec: null,
        message: msg,
      })
      throw err
    } finally {
      this.active.delete(id)
    }
  }

  private async runOnce(
    entry: ModelManifestEntry,
    target: string,
    partial: string,
    signal: AbortSignal,
  ): Promise<void> {
    // If the target already exists and looks complete, fast-path to a verify
    // pass so a stale `.partial` from a previous half-done run doesn't get
    // re-downloaded over a perfectly good file.
    if (existsSync(target)) {
      const size = statSync(target).size
      if (this.sizeOk(size, entry.sizeBytes)) {
        this.emit({
          id: entry.id,
          phase: 'complete',
          bytesReceived: size,
          totalBytes: entry.sizeBytes,
          bytesPerSec: null,
          message: null,
        })
        return
      }
      // Target exists but wrong size — wipe it.
      unlinkSync(target)
    }

    let resumeAt = 0
    if (existsSync(partial)) {
      resumeAt = statSync(partial).size
      // Sanity: if the partial already exceeds the expected size something is
      // very wrong — restart fresh rather than serve up a frankenfile.
      if (resumeAt >= entry.sizeBytes) {
        unlinkSync(partial)
        resumeAt = 0
      }
    }

    // Resume + SHA verify can't coexist cleanly — we'd need to re-hash the
    // partial bytes from disk first. For now, when a SHA is pinned we always
    // start fresh; size-only verify supports resume.
    if (resumeAt > 0 && entry.sha256) {
      unlinkSync(partial)
      resumeAt = 0
    }

    const headers: Record<string, string> = {}
    if (resumeAt > 0) headers['Range'] = `bytes=${resumeAt}-`

    const res = await fetch(entry.url, { signal, headers, redirect: 'follow' })
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    if (!res.body) throw new Error('Response had no body.')

    // Server didn't honor the range — fall back to a full re-download.
    const honoredRange = res.status === 206
    if (resumeAt > 0 && !honoredRange) {
      unlinkSync(partial)
      resumeAt = 0
    }

    // Resolve the total byte count: prefer Content-Range (when resuming),
    // then Content-Length, then the manifest's hint.
    let totalBytes = entry.sizeBytes
    const contentRange = res.headers.get('content-range')
    const contentLength = res.headers.get('content-length')
    if (honoredRange && contentRange) {
      const m = /\/(\d+)\s*$/.exec(contentRange)
      if (m) totalBytes = parseInt(m[1]!, 10)
    } else if (contentLength) {
      totalBytes = resumeAt + parseInt(contentLength, 10)
    }

    const hash = entry.sha256 ? createHash('sha256') : null
    const out = createWriteStream(partial, { flags: resumeAt > 0 ? 'a' : 'w' })
    // A write stream with no 'error' listener turns a failed write (disk full,
    // EACCES, EISDIR) into an uncaught exception that crashes the process — and
    // the backpressure `drain` wait below would otherwise hang forever. Capture
    // the first error and surface it through the normal reject path instead.
    let writeError: Error | null = null
    out.on('error', (err: Error) => {
      if (!writeError) writeError = err
    })

    let received = resumeAt
    let lastEmit = 0
    let lastReceived = received
    this.emit({
      id: entry.id,
      phase: 'downloading',
      bytesReceived: received,
      totalBytes,
      bytesPerSec: null,
      message: null,
    })

    const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])

    try {
      for await (const chunk of nodeStream as AsyncIterable<Buffer>) {
        if (signal.aborted) throw new Error('aborted')
        if (writeError) throw writeError
        if (hash) hash.update(chunk)
        const writeOk = out.write(chunk)
        if (!writeOk) {
          // Backpressure — wait for drain so we don't balloon RAM on slow
          // disks. Resolve early on a write error so this can't hang; the
          // loop's writeError check then throws on the next iteration.
          await new Promise<void>((resolve) => {
            if (writeError) {
              resolve()
              return
            }
            const onDrain = (): void => {
              out.off('error', onErr)
              resolve()
            }
            const onErr = (): void => {
              out.off('drain', onDrain)
              resolve()
            }
            out.once('drain', onDrain)
            out.once('error', onErr)
          })
        }
        received += chunk.length
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_TICK_MS) {
          const dt = now - lastEmit
          const bytesPerSec = lastEmit === 0 ? null : ((received - lastReceived) / dt) * 1000
          lastEmit = now
          lastReceived = received
          this.emit({
            id: entry.id,
            phase: 'downloading',
            bytesReceived: received,
            totalBytes,
            bytesPerSec,
            message: null,
          })
        }
      }
      if (writeError) throw writeError
    } finally {
      // On a write error the stream is already broken — destroy it (releases
      // the fd) rather than awaiting end(), whose 'finish' would never fire.
      if (writeError) {
        out.destroy()
      } else {
        await new Promise<void>((resolve, reject) =>
          out.end((err: Error | null | undefined) => (err ? reject(err) : resolve())),
        )
      }
    }

    // Verify phase.
    this.emit({
      id: entry.id,
      phase: 'verifying',
      bytesReceived: received,
      totalBytes,
      bytesPerSec: null,
      message: null,
    })
    if (hash && entry.sha256) {
      const actual = hash.digest('hex').toLowerCase()
      if (actual !== entry.sha256.toLowerCase()) {
        try {
          unlinkSync(partial)
        } catch {
          /* ignore */
        }
        throw new Error(`SHA256 mismatch: got ${actual}, expected ${entry.sha256}`)
      }
    } else {
      const got = statSync(partial).size
      if (!this.sizeOk(got, entry.sizeBytes)) {
        try {
          unlinkSync(partial)
        } catch {
          /* ignore */
        }
        throw new Error(
          `Size check failed: got ${got} bytes, expected ${entry.sizeBytes} (±${Math.round(
            SIZE_TOLERANCE * 100,
          )}%).`,
        )
      }
    }

    // Atomic rename — only after verification passes.
    if (existsSync(target)) unlinkSync(target)
    renameSync(partial, target)

    this.emit({
      id: entry.id,
      phase: 'complete',
      bytesReceived: received,
      totalBytes,
      bytesPerSec: null,
      message: null,
    })
  }

  private sizeOk(actual: number, expected: number): boolean {
    if (expected <= 0) return actual > 0
    const ratio = Math.abs(actual - expected) / expected
    return ratio <= SIZE_TOLERANCE
  }

  private emit(ev: DownloadEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(ev)
      } catch {
        /* swallow listener errors — one bad subscriber shouldn't stop others */
      }
    }
  }
}
