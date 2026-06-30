/**
 * Gate for the PyTorch embedding sidecar (EmbedderSidecar). It replaces
 * node-llama-cpp for embedding ONLY where it pays off and is supported:
 *   - tier === 'pro' (Standard/Lite keep the llama.cpp embedder), AND
 *   - an NVIDIA GPU (torch-CUDA; there's no usable torch-ROCm on Windows, so
 *     AMD/Intel Pro boxes stay on llama.cpp), AND
 *   - the sidecar (python + script) actually resolves on disk.
 *
 * Escape hatches: LOKLM_PYTORCH_EMBEDDER=1 forces it on (dev / no-marker boxes,
 * which otherwise stay off so we never surprise a non-NVIDIA dev machine);
 * LOKLM_DISABLE_PYTORCH_EMBEDDER=1 forces it off everywhere. Even when enabled,
 * if the sidecar fails to start the caller transparently falls back to the
 * node-llama-cpp embedder — this gate only decides whether to TRY.
 */

import { getEffectiveTier, readTierMarker } from '../tier/TierMarker'
import { resolveEmbedderSidecar } from './EmbedderSidecar'

export interface PytorchEmbedderConfig {
  pythonPath: string
  scriptPath: string
  model: string
  device: 'cuda'
  cudaDeviceIndex: number | null
  maxSeq: number
  hfHome: string | null
}

function isNvidia(arch?: string | null): boolean {
  return typeof arch === 'string' && arch.toLowerCase().includes('nvidia')
}

// Log the gate decision exactly ONCE per process. isPytorchEmbedderEnabled is
// called per embed batch (from ensureReady), so logging on every call would
// spam the terminal; its inputs (env, marker, venv presence) are static for a
// run, so one line is enough. This is the line that was missing before: a
// silently-disabled sidecar (wrong tier / no venv) was indistinguishable from a
// hang, because the fallback to llama.cpp logged nothing about WHY.
let gateLogged = false
function logGateOnce(msg: string): void {
  if (gateLogged) return
  gateLogged = true
  // eslint-disable-next-line no-console
  console.log(`[embedder] PyTorch sidecar gate: ${msg}`)
}

/** True when we should TRY the PyTorch sidecar for embedding. Cheap enough to
 *  call from ensureReady; the heavy work (spawn/model-load) is the caller's. */
export function isPytorchEmbedderEnabled(): boolean {
  if (process.env['LOKLM_DISABLE_PYTORCH_EMBEDDER'] === '1') {
    logGateOnce('disabled (LOKLM_DISABLE_PYTORCH_EMBEDDER=1) — using llama.cpp embedder')
    return false
  }
  const forced = process.env['LOKLM_PYTORCH_EMBEDDER'] === '1'
  // Tier via getEffectiveTier() so the `pnpm dev --pro` LOKLM_TIER override is
  // honoured — readTierMarker() returns null in dev (no install marker), which
  // is exactly why a dev `--pro` run never enabled the sidecar before. Every
  // other tier gate (e.g. isCodebaseIndexingEnabled) already uses this.
  const tier = getEffectiveTier()
  const marker = readTierMarker()
  // NVIDIA gate: a packaged install recorded the GPU arch at wizard time, so we
  // honour it exactly. In dev there's no marker, so trust the tier intent — the
  // sidecar's own torch.cuda.is_available() check is the real backstop (a
  // non-NVIDIA box fails its `ready` handshake and we fall back to llama.cpp).
  const arch = marker?.hardware?.gpuArch
  const nvidiaOk = arch != null ? isNvidia(arch) : true
  const tierOk = forced || (tier === 'pro' && nvidiaOk)
  if (!tierOk) {
    logGateOnce(
      `off (tier=${tier ?? 'none'}, nvidia=${nvidiaOk}, forced=${forced}) — using llama.cpp embedder. ` +
        'Pro/NVIDIA only; in dev pass `pnpm dev --pro` or LOKLM_PYTORCH_EMBEDDER=1.',
    )
    return false
  }
  const resolved = resolveEmbedderSidecar() != null
  logGateOnce(
    resolved
      ? `on (tier=${tier ?? 'none'}, forced=${forced}) — trying PyTorch sidecar`
      : `wanted on (tier=${tier ?? 'none'}, forced=${forced}) but no sidecar found on disk — ` +
          'create sidecars/embedder/.venv (see sidecars/embedder/README.md). Using llama.cpp embedder.',
  )
  return resolved
}

/** Resolved config for spawning the sidecar, or null if it can't be located.
 *  `hfHome` (install-local model cache) is supplied by the caller. */
export function pytorchEmbedderConfig(opts?: { hfHome?: string | null }): PytorchEmbedderConfig | null {
  const resolved = resolveEmbedderSidecar()
  if (!resolved) return null
  const idxEnv = process.env['LOKLM_EMBEDDER_CUDA_INDEX']
  const parsed = idxEnv != null && idxEnv !== '' ? Number(idxEnv) : 0
  return {
    pythonPath: resolved.pythonPath,
    scriptPath: resolved.scriptPath,
    model: process.env['LOKLM_PYTORCH_EMBEDDER_MODEL'] ?? 'Qwen/Qwen3-Embedding-0.6B',
    device: 'cuda',
    cudaDeviceIndex: Number.isFinite(parsed) ? parsed : 0,
    maxSeq: 512,
    hfHome: opts?.hfHome ?? null,
  }
}
