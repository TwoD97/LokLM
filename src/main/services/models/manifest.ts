/**
 * Manifest of models the app may download on first launch. Mirrors the
 * canonical list in `scripts/download-models.mjs` so the dev workflow and the
 * runtime first-launch downloader stay in lockstep.
 *
 * SHA256 hashes are optional. When present the downloader streams the body
 * through a hasher and rejects mismatches; when absent it falls back to a
 * size check (Content-Length must equal `sizeBytes` exactly, or — if the
 * server doesn't send Content-Length — the received bytes must be within ±2%
 * of `sizeBytes`). Fill these in once we have a release pin: run
 * `Get-FileHash -Algorithm SHA256 <path>` against your local copy.
 */

export type ModelKind = 'llm' | 'embedder' | 'reranker'

export interface ModelManifestEntry {
  /** Stable ID used in IPC events + UI state. Filename without `.gguf`. */
  id: string
  /** Short human label shown in the download UI. */
  label: string
  /** Longer description shown beside the label. */
  description: string
  /** What slot this model fills in the app — drives "is the app ready" gating. */
  kind: ModelKind
  /** Disk filename (relative to the download target dir). */
  filename: string
  /** HTTPS download URL. Must support HTTP Range requests for resume to work. */
  url: string
  /** Expected byte size — drives the progress %. Don't make up numbers; copy
   *  from `Content-Length` of the URL or `Get-Item`. */
  sizeBytes: number
  /** Optional SHA-256 (lowercase hex). When set, downloads that don't match
   *  are deleted and the user is asked to retry. */
  sha256?: string
  /** Required models gate the first-launch UI — the user can't proceed past
   *  the welcome screen until every required model is present. */
  required: boolean
}

/**
 * Legacy first-launch set: embedder + reranker ONLY. The LLM entry
 * (Qwen3-8B, the v0.2.2 ship-set) was retired in v0.4.x: the installer
 * wizard owns LLM acquisition since v0.3.0 (tier bundles), and keeping an
 * LLM here meant any install where the tier marker wasn't found re-pulled
 * an obsolete 5 GB model next to the wizard's current one. LLM discovery is
 * filename-pattern-based (LlamaService.discoverProfiles), so whatever GGUF
 * the wizard installed keeps working without a manifest entry.
 *
 * Sizes + SHA256s pinned against the local validated copies on the build
 * machine on 2026-05-19. HuggingFace serves stable bytes for
 * `resolve/main/<file>` URLs, so a download from the same revision should
 * hash-match. If the upstream repo re-quantises or re-uploads we'll need to
 * re-pin — until then the downloader hard-fails on mismatch.
 */
export const MODEL_MANIFEST: ModelManifestEntry[] = [
  {
    id: 'bge-m3-Q4_K_M',
    label: 'Embedder',
    description: 'BGE-M3 (Q4_K_M) — used to index your documents for retrieval.',
    kind: 'embedder',
    filename: 'bge-m3-Q4_K_M.gguf',
    url: 'https://huggingface.co/lm-kit/bge-m3-gguf/resolve/main/bge-m3-Q4_K_M.gguf',
    sizeBytes: 437_778_592,
    sha256: 'e251234fcb7d050991a6be491952f485bf5c641dd10c3272dc1301fd281ad50f',
    required: true,
  },
  {
    id: 'bge-reranker-v2-m3-Q4_K_M',
    label: 'Reranker',
    description: 'BGE Reranker v2-M3 (Q4_K_M) — re-scores retrieved passages by relevance.',
    kind: 'reranker',
    filename: 'bge-reranker-v2-m3-Q4_K_M.gguf',
    url: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q4_K_M.gguf',
    sizeBytes: 438_376_864,
    sha256: 'e186a244ed455b4ab66ec64339ce7427a6ae13f5c0b5e544de96e50f0f8b3673',
    required: true,
  },
]

export function getManifestEntry(id: string): ModelManifestEntry | undefined {
  return MODEL_MANIFEST.find((m) => m.id === id)
}

export function getRequiredManifestEntries(): ModelManifestEntry[] {
  return MODEL_MANIFEST.filter((m) => m.required)
}
