/**
 * Orchestrates the MADLAD translation layer: model download (on demand , via
 * the shared ModelDownloader) , sidecar lifecycle (lazy start on first
 * translate , resident until quit) , sentence segmentation and reassembly.
 *
 * Deliberately NOT part of the first-launch model gating — translation is an
 * optional feature; a missing model or missing sidecar binary degrades to a
 * clear status , never to a broken app.
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { ModelDownloader } from '../models/ModelDownloader'
import { detectIsoLanguage } from '../documents/languageDetector'
import { getModelSearchDirs } from '../models/paths'
import type {
  TranslateOptions,
  TranslateResult,
  TranslatorState,
  TranslatorStatus,
} from '../../../shared/translation'
import { TRANSLATOR_FILES, TRANSLATOR_MODEL_DIRNAME } from './manifest'
import { segmentForTranslation } from './segment'
import { TranslatorSidecar, resolveTranslatorBinary } from './TranslatorSidecar'

/** Same tolerance as models/availability.ts — content-length jitter. */
const SIZE_TOLERANCE = 0.02

/** Sentences per sidecar request. CT2 batches internally; this just bounds
 *  per-request latency so a long document yields progress in chunks. */
const BATCH_SIZE = 32

/** Greedy , like the reference CT2-MADLAD usage. An early smoke test showed
 *  hallucinated tails that looked like a greedy artifact — root cause was the
 *  missing `</s>` on the source (fixed in the sidecar) , greedy is clean since.
 *  Beam stays a per-request knob; the FLORES eval pack can revisit the default
 *  with data if quality on the long tail says otherwise. */
const DEFAULT_BEAM = 1

export class TranslationService {
  private sidecar: TranslatorSidecar | null = null
  private state: TranslatorState
  private lastError: string | null = null

  constructor(
    private readonly downloader: ModelDownloader,
    private readonly onStatus?: (s: TranslatorStatus) => void,
  ) {
    this.state = this.locateModelDir() ? 'installed' : 'not_installed'
  }

  status(): TranslatorStatus {
    // Idle states are re-derived on read — files may appear (wizard install ,
    // manual copy) or vanish without this process being told.
    if (this.state === 'not_installed' || this.state === 'installed') {
      this.state = this.locateModelDir() ? 'installed' : 'not_installed'
    }
    return {
      state: this.state,
      message: this.lastError,
      sidecarAvailable: resolveTranslatorBinary() !== null,
    }
  }

  /** Download the four model files (~2.76 GB). Progress is published through
   *  the shared ModelDownloader listeners (ids `translator-*`). */
  async install(): Promise<void> {
    if (this.state === 'downloading') return
    if (this.locateModelDir()) {
      this.setState('installed')
      return
    }
    this.lastError = null
    this.setState('downloading')
    try {
      // Sequential on purpose: parallel multi-GB streams thrash the disk and
      // the per-file progress events would interleave confusingly in the UI.
      for (const f of TRANSLATOR_FILES) {
        await this.downloader.downloadEntry(f)
      }
      // downloadEntry resolves quietly on user cancel — re-check the disk
      // instead of assuming success.
      this.setState(this.locateModelDir() ? 'installed' : 'not_installed')
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.setState('error')
      throw err
    }
  }

  cancelInstall(): void {
    for (const f of TRANSLATOR_FILES) this.downloader.cancel(f.id)
  }

  async translate(text: string, opts: TranslateOptions): Promise<TranslateResult> {
    const t0 = Date.now()
    const seg = segmentForTranslation(text)
    if (seg.sentences.length === 0) return { text, detected: null, sentences: 0, ms: 0 }

    const sidecar = await this.ensureSidecar()
    // Informational only (MADLAD needs no source token) — eld is sub-ms after
    // its one-time load , and the first translate already pays a model spawn.
    const detected = await detectIsoLanguage(text).catch(() => null)
    const translated: string[] = []
    for (let i = 0; i < seg.sentences.length; i += BATCH_SIZE) {
      const batch = seg.sentences.slice(i, i + BATCH_SIZE)
      translated.push(
        ...(await sidecar.translate(batch, opts.target, Math.max(1, opts.beam ?? DEFAULT_BEAM))),
      )
    }
    return {
      text: seg.reassemble(translated),
      detected,
      sentences: seg.sentences.length,
      ms: Date.now() - t0,
    }
  }

  /** Kill the sidecar (app quit). Safe to call when never started. */
  async dispose(): Promise<void> {
    const s = this.sidecar
    this.sidecar = null
    if (s) await s.dispose()
  }

  // -------------------------------------------------------------------------

  private setState(state: TranslatorState): void {
    this.state = state
    this.onStatus?.({
      state,
      message: this.lastError,
      sidecarAvailable: resolveTranslatorBinary() !== null,
    })
  }

  /** First search dir containing all four files at plausible sizes , or null.
   *  Mirrors the multi-dir policy of models/paths.ts so a wizard-installed
   *  copy next to the exe is found just like a downloaded one. */
  private locateModelDir(): string | null {
    for (const dir of getModelSearchDirs()) {
      const candidate = join(dir, TRANSLATOR_MODEL_DIRNAME)
      const complete = TRANSLATOR_FILES.every((f) => {
        const basename = f.filename.slice(TRANSLATOR_MODEL_DIRNAME.length + 1)
        const p = join(candidate, basename)
        if (!existsSync(p)) return false
        try {
          const size = statSync(p).size
          return Math.abs(size - f.sizeBytes) / f.sizeBytes <= SIZE_TOLERANCE
        } catch {
          return false
        }
      })
      if (complete) return candidate
    }
    return null
  }

  private spawnSidecar(bin: string, modelDir: string): TranslatorSidecar {
    return new TranslatorSidecar({
      binPath: bin,
      // --device auto: the sidecar uses the GPU when one has enough free VRAM ,
      // else CPU (a CPU-only binary always reports cpu). No-op for the CPU build.
      args: ['--model', modelDir, '--device', 'auto'],
      events: {
        onStateChange: (s, detail) => {
          if (s === 'starting') this.setState('starting')
          else if (s === 'ready') this.setState('ready')
          else {
            // exited — crash or dispose. Keep an explicit error state only for
            // crashes; a clean dispose lands back on 'installed'.
            this.sidecar = null
            if (this.state === 'starting' || this.state === 'ready') {
              this.lastError = detail ?? null
              this.setState(this.locateModelDir() ? 'installed' : 'not_installed')
            }
          }
        },
        // eslint-disable-next-line no-console
        onLog: (line) => console.warn(`[translator] ${line}`),
      },
    })
  }

  private async ensureSidecar(): Promise<TranslatorSidecar> {
    if (this.sidecar?.isRunning()) {
      // Possibly still loading — start() is idempotent and resolves on ready.
      await this.sidecar.start()
      return this.sidecar
    }

    const modelDir = this.locateModelDir()
    if (!modelDir) {
      this.setState('not_installed')
      throw new Error('translation model is not installed')
    }
    const bin = resolveTranslatorBinary()
    if (!bin) {
      throw new Error(
        'translator sidecar binary not found — build it with scripts/build-translator-sidecar.ps1',
      )
    }

    try {
      const sidecar = this.spawnSidecar(bin, modelDir)
      this.sidecar = sidecar
      await sidecar.start()
      return sidecar
    } catch (err) {
      // The GPU binary can fail to even start on a machine without the NVIDIA
      // driver (missing nvcuda.dll) — the wizard gates the CUDA payload on GPU
      // detection , but retry on the CPU binary defensively so translation still
      // works rather than hard-failing.
      const cpuBin = resolveTranslatorBinary({ cpuOnly: true })
      if (cpuBin && cpuBin !== bin) {
        // eslint-disable-next-line no-console
        console.warn(
          `[translator] GPU sidecar failed to start (${err instanceof Error ? err.message : err}); falling back to CPU`,
        )
        try {
          const fallback = this.spawnSidecar(cpuBin, modelDir)
          this.sidecar = fallback
          await fallback.start()
          return fallback
        } catch (err2) {
          this.sidecar = null
          this.lastError = err2 instanceof Error ? err2.message : String(err2)
          this.setState('error')
          throw err2
        }
      }
      this.sidecar = null
      this.lastError = err instanceof Error ? err.message : String(err)
      this.setState('error')
      throw err
    }
  }
}
