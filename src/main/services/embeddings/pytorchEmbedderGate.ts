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

import { readTierMarker } from '../tier/TierMarker'
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

/** True when we should TRY the PyTorch sidecar for embedding. Cheap enough to
 *  call from ensureReady; the heavy work (spawn/model-load) is the caller's. */
export function isPytorchEmbedderEnabled(): boolean {
  if (process.env['LOKLM_DISABLE_PYTORCH_EMBEDDER'] === '1') return false
  const forced = process.env['LOKLM_PYTORCH_EMBEDDER'] === '1'
  const marker = readTierMarker()
  const tierOk = forced || (marker?.tier === 'pro' && isNvidia(marker.hardware?.gpuArch))
  if (!tierOk) return false
  return resolveEmbedderSidecar() != null
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
