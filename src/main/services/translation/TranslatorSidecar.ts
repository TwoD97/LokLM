/**
 * Main-side RPC client for the loklm-translator sidecar (a native exe , see
 * sidecars/translator/README.md for the protocol). Same request/response-by-id
 * idiom as ModelsWorkerClient , but over child_process stdio NDJSON instead of
 * utilityProcess postMessage — the sidecar is C++ , not a Node worker.
 *
 * Lifecycle: start() spawns and resolves on the sidecar's `ready` handshake
 * (the 3 GB model takes seconds to load from cold disk). The sidecar exits on
 * its own when stdin closes , so a dead main process can't leave a 3 GB
 * orphan; dispose() additionally asks for a graceful shutdown then kills.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  op: string
}

export interface TranslatorSidecarEvents {
  /** Coarse lifecycle , consumed by TranslationService for status pushes. */
  onStateChange?: (state: 'starting' | 'ready' | 'exited', detail?: string) => void
  /** Sidecar stderr lines (free-form log text). */
  onLog?: (line: string) => void
}

export interface TranslatorSidecarOptions {
  binPath: string
  args: string[]
  /** Model load budget before start() rejects. Default 120 s. */
  startTimeoutMs?: number
  events?: TranslatorSidecarEvents
}

/**
 * Locate the sidecar binary. Order: explicit env override (tests , unusual
 * setups) → packaged resources (electron-builder extraResources) → the dev
 * build outputs from scripts/build-translator-sidecar.ps1.
 *
 * The CUDA variant (`-cuda`) is preferred when present: it's only ever staged
 * on machines that can run it (the CUDA payload , or a dev box that ran the
 * build with -Cuda) , and it auto-falls-back to CPU when no GPU is free. The
 * plain binary is CPU-only and is the universal default.
 */
export function resolveTranslatorBinary(opts?: { cpuOnly?: boolean }): string | null {
  const win = process.platform === 'win32'
  const cpu = win ? 'loklm-translator.exe' : 'loklm-translator'
  const cuda = win ? 'loklm-translator-cuda.exe' : 'loklm-translator-cuda'
  const dirs = [
    process.resourcesPath ? join(process.resourcesPath, 'translator') : undefined,
    // dev: the -Cuda build stages a self-contained dist-cuda/ (binary + libs);
    // checked before dist/ so the GPU binary wins on a dev box.
    join(process.cwd(), 'sidecars', 'translator', 'dist-cuda'),
    join(process.cwd(), 'sidecars', 'translator', 'dist'),
    join(process.cwd(), 'sidecars', 'translator', 'build', 'bin'),
  ].filter((d): d is string => d != null)

  // Explicit override (tests/unusual setups) — but not for the cpuOnly retry ,
  // which must reach the CPU binary even if the override points at the GPU one.
  if (
    !opts?.cpuOnly &&
    process.env.LOKLM_TRANSLATOR_BIN &&
    existsSync(process.env.LOKLM_TRANSLATOR_BIN)
  ) {
    return process.env.LOKLM_TRANSLATOR_BIN
  }
  // GPU-capable binary (shipped in the CUDA payload) wins , then fall back to
  // the universal CPU binary. cpuOnly skips the GPU one entirely.
  const names = opts?.cpuOnly ? [cpu] : [cuda, cpu]
  for (const name of names) {
    for (const dir of dirs) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

export class TranslatorSidecar {
  private child: ChildProcess | null = null
  private startPromise: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor(private readonly opts: TranslatorSidecarOptions) {}

  isRunning(): boolean {
    return this.child !== null
  }

  /** Spawn + wait for the ready handshake. Idempotent while alive. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (err?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }

      const timeoutMs = this.opts.startTimeoutMs ?? 120_000
      const timer = setTimeout(() => {
        try {
          this.child?.kill()
        } catch {
          /* already gone */
        }
        settle(new Error(`translator sidecar not ready within ${timeoutMs} ms`))
      }, timeoutMs)
      // Don't keep the process alive just for this timer (vitest , scripts).
      timer.unref?.()

      let child: ChildProcess
      try {
        child = spawn(this.opts.binPath, this.opts.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch (err) {
        settle(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.child = child
      this.opts.events?.onStateChange?.('starting')

      createInterface({ input: child.stdout! }).on('line', (line) => {
        this.onLine(line, settle)
      })
      createInterface({ input: child.stderr! }).on('line', (line) => {
        this.opts.events?.onLog?.(line)
      })

      child.on('error', (err) => {
        // Spawn failure (ENOENT , EACCES). The 'exit' handler won't fire.
        this.teardown(`translator sidecar failed to spawn: ${err.message}`)
        settle(err)
      })
      child.on('exit', (code) => {
        const reason = `translator sidecar exited (code=${code ?? 'null'})`
        this.teardown(reason)
        settle(new Error(reason))
      })
    })
    return this.startPromise
  }

  /** Translate a batch of sentences. Caller must have awaited start(). */
  async translate(texts: string[], target: string, beam: number): Promise<string[]> {
    const res = await this.send<{ results: string[] }>('translate', { texts, target, beam })
    return res.results
  }

  async ping(): Promise<void> {
    // send() resolves with the raw response frame — swallow it , ping is
    // only a liveness probe.
    await this.send<unknown>('ping')
  }

  /** Graceful shutdown with a kill fallback , mirroring ModelsWorkerClient. */
  async dispose(): Promise<void> {
    const child = this.child
    if (!child) return
    try {
      await Promise.race([
        this.send<void>('shutdown'),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 1000)
          t.unref?.()
        }),
      ])
    } catch {
      /* ignore — we're killing it anyway */
    }
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    this.teardown('disposed')
  }

  private teardown(reason: string): void {
    for (const p of this.pending.values()) p.reject(new Error(reason))
    this.pending.clear()
    if (this.child) {
      this.child = null
      this.startPromise = null
      this.opts.events?.onStateChange?.('exited', reason)
    }
  }

  private onLine(line: string, settleStart: (err?: Error) => void): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.opts.events?.onLog?.(`dropped unparseable sidecar line: ${line.slice(0, 200)}`)
      return
    }
    if (typeof msg.ev === 'string') {
      if (msg.ev === 'ready') {
        this.opts.events?.onStateChange?.('ready')
        settleStart()
      } else if (msg.ev === 'fatal') {
        settleStart(new Error(String(msg.error ?? 'translator sidecar reported a fatal error')))
      }
      return
    }
    if (typeof msg.id !== 'number') {
      this.opts.events?.onLog?.(`dropped malformed sidecar frame: ${line.slice(0, 200)}`)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg)
    else p.reject(new Error(String(msg.error ?? 'translator sidecar error')))
  }

  private send<T>(op: string, payload?: Record<string, unknown>): Promise<T> {
    const child = this.child
    if (!child || !child.stdin?.writable) {
      return Promise.reject(new Error('translator sidecar is not running'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op })
      try {
        child.stdin!.write(`${JSON.stringify({ id, op, ...payload })}\n`)
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }
}
