/**
 * Main-side RPC client for the loklm-embedder sidecar (a Python process running
 * sentence-transformers, see sidecars/embedder/embed_sidecar.py). Same NDJSON
 * request/response-by-id idiom as TranslatorSidecar — the embedder is Python
 * (PyTorch), not a Node worker, so it talks over child_process stdio.
 *
 * Why a sidecar (Pro/NVIDIA only): node-llama-cpp embeds one sequence per decode
 * and caps at ~6-11k tok/s on a 5090 (GPU idles at ~175 W). PyTorch fp16 with
 * true batched matmuls measured ~74k tok/s on the same model/GPU (~12x), so bulk
 * indexing on a 30 GB corpus drops from ~12 h to under an hour. The chat LLM and
 * reranker stay on llama.cpp — this replaces ONLY the embedder, and only where
 * it pays off (see pytorchEmbedderGate.ts).
 *
 * Lifecycle mirrors TranslatorSidecar: start() spawns and resolves on the
 * sidecar's `ready` handshake; the process exits when stdin closes, so a dead
 * main process can't leave a torch process holding VRAM; dispose() asks for a
 * graceful shutdown then kills.
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

export interface EmbedderSidecarEvents {
  onStateChange?: (state: 'starting' | 'ready' | 'exited', detail?: string) => void
  onLog?: (line: string) => void
}

export interface EmbedderSidecarOptions {
  /** Path to the Python interpreter that has torch + sentence-transformers. */
  pythonPath: string
  /** Path to embed_sidecar.py. */
  scriptPath: string
  /** HF model id or local path. Default Qwen/Qwen3-Embedding-0.6B. */
  model?: string
  /** 'cuda' | 'cpu'. The sidecar fails ready if cuda is requested but absent,
   *  so the caller falls back to node-llama-cpp instead of a slow CPU torch. */
  device?: 'cuda' | 'cpu'
  /** Physical CUDA device index to pin the process to (CUDA_VISIBLE_DEVICES). */
  cudaDeviceIndex?: number | null
  /** Cap tokens/sequence — bounds padding + VRAM. Default 512 (chunks ~400 tok). */
  maxSeq?: number
  /** HF cache dir, so the model download/lookup is install-local not in $HOME. */
  hfHome?: string | null
  /** Model-load budget before start() rejects. First run may download ~1.2 GB,
   *  so this is generous; packaged installs bundle the model and load fast. */
  startTimeoutMs?: number
  events?: EmbedderSidecarEvents
}

/**
 * Locate the Python interpreter + sidecar script. Order mirrors
 * resolveTranslatorBinary: explicit env override → packaged resources
 * (electron-builder extraResources under resources/embedder) → the dev venv at
 * sidecars/embedder/.venv. Returns null when no usable interpreter is found, in
 * which case the caller keeps the node-llama-cpp embedder.
 */
export function resolveEmbedderSidecar(): { pythonPath: string; scriptPath: string } | null {
  const win = process.platform === 'win32'
  const pyRel = win ? join('Scripts', 'python.exe') : join('bin', 'python')

  // Explicit override (tests / unusual setups / a user-provided torch env).
  const envPy = process.env['LOKLM_EMBEDDER_PYTHON']
  const envScript = process.env['LOKLM_EMBEDDER_SCRIPT']
  const dirsScript = [
    process.resourcesPath ? join(process.resourcesPath, 'embedder', 'embed_sidecar.py') : undefined,
    join(process.cwd(), 'sidecars', 'embedder', 'embed_sidecar.py'),
  ].filter((d): d is string => d != null)
  const script = envScript && existsSync(envScript) ? envScript : dirsScript.find(existsSync) ?? null
  if (!script) return null

  if (envPy && existsSync(envPy)) return { pythonPath: envPy, scriptPath: script }

  const pyDirs = [
    process.resourcesPath ? join(process.resourcesPath, 'embedder', 'venv', pyRel) : undefined,
    join(process.cwd(), 'sidecars', 'embedder', '.venv', pyRel),
  ].filter((d): d is string => d != null)
  const python = pyDirs.find(existsSync) ?? null
  if (!python) return null
  return { pythonPath: python, scriptPath: script }
}

export class EmbedderSidecar {
  private child: ChildProcess | null = null
  private startPromise: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor(private readonly opts: EmbedderSidecarOptions) {}

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

      const timeoutMs = this.opts.startTimeoutMs ?? 300_000
      const timer = setTimeout(() => {
        try {
          this.child?.kill()
        } catch {
          /* already gone */
        }
        settle(new Error(`embedder sidecar not ready within ${timeoutMs} ms`))
      }, timeoutMs)
      timer.unref?.()

      const args = [
        this.opts.scriptPath,
        '--model',
        this.opts.model ?? 'Qwen/Qwen3-Embedding-0.6B',
        '--device',
        this.opts.device ?? 'cuda',
        '--max-seq',
        String(this.opts.maxSeq ?? 512),
      ]
      // Pin the process to the resolved physical GPU (same idea as the worker's
      // CUDA_VISIBLE_DEVICES). PYTHONUNBUFFERED guarantees the ready frame and
      // responses flush promptly. HF_HOME keeps the model cache install-local.
      // PYTHONUTF8/PYTHONIOENCODING force UTF-8 stdio: on Windows a piped child
      // otherwise decodes our UTF-8 NDJSON as the locale code page (cp1252),
      // turning every non-ASCII passage into mojibake and multi-byte chars into
      // lone surrogates that break the tokenizer. (The sidecar also reconfigures
      // its streams defensively — this is the belt to that suspenders.)
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      }
      if (this.opts.cudaDeviceIndex != null) {
        env['CUDA_VISIBLE_DEVICES'] = String(this.opts.cudaDeviceIndex)
      }
      if (this.opts.hfHome) env['HF_HOME'] = this.opts.hfHome

      let child: ChildProcess
      try {
        child = spawn(this.opts.pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env,
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
        this.teardown(`embedder sidecar failed to spawn: ${err.message}`)
        settle(err)
      })
      child.on('exit', (code) => {
        const reason = `embedder sidecar exited (code=${code ?? 'null'})`
        this.teardown(reason)
        settle(new Error(reason))
      })
    })
    return this.startPromise
  }

  /**
   * Embed a batch of already-prepared strings (the caller applies the query
   * instruction / passage prefix, exactly as for node-llama-cpp, so vectors stay
   * in the same space). Returns one entry per input, null for empty inputs —
   * matching ModelsWorkerClient.embedderEmbed's Array<number[] | null> contract.
   */
  async embed(texts: string[], batchSize = 64): Promise<Array<number[] | null>> {
    const res = await this.send<{ vectors: Array<number[] | null> }>('embed', {
      texts,
      batch_size: batchSize,
      normalize: true,
    })
    return res.vectors
  }

  async ping(): Promise<void> {
    await this.send<unknown>('ping')
  }

  /** Graceful shutdown with a kill fallback, mirroring TranslatorSidecar. */
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
        settleStart(new Error(String(msg.error ?? 'embedder sidecar reported a fatal error')))
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
    else p.reject(new Error(String(msg.error ?? 'embedder sidecar error')))
  }

  private send<T>(op: string, payload?: Record<string, unknown>): Promise<T> {
    const child = this.child
    if (!child || !child.stdin?.writable) {
      return Promise.reject(new Error('embedder sidecar is not running'))
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
