import bundles from '../../../../installer-wizard/model-manifest.json'
import { readTierMarker } from '../tier/TierMarker'
import { getManifestEntry, MODEL_MANIFEST, type ModelManifestEntry } from './manifest'
import { resolveModelFile } from './paths'

// Repair compatibility only: the existing Lite loader accepts 2B when 4B is absent.
const legacyLiteLlm: ModelManifestEntry = {
  id: 'Qwen_Qwen3.5-2B-Q4_K_M',
  label: 'Language model',
  description: 'Qwen3.5 2B — language model for this existing Lite installation.',
  kind: 'llm',
  filename: 'Qwen3.5-2B-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf',
  sizeBytes: 1_280_835_840,
  sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
  required: true,
}

/** Installed tiers describe expected files, not proof they still exist. */
export function getActiveModelManifest(): ModelManifestEntry[] {
  const marker = readTierMarker()
  if (!marker) return MODEL_MANIFEST
  return bundles.tiers[marker.tier].models.flatMap((entry): ModelManifestEntry[] => {
    const kind = entry.role
    if (kind !== 'llm' && kind !== 'embedder' && kind !== 'reranker') return []
    if (
      marker.tier === 'lite' &&
      kind === 'llm' &&
      !resolveModelFile(entry.filename) &&
      (resolveModelFile(legacyLiteLlm.filename) ||
        marker.models.some((model) => model?.id === legacyLiteLlm.id))
    )
      return [{ ...legacyLiteLlm }]
    return [
      {
        id: entry.id,
        label: kind === 'llm' ? 'Language model' : kind === 'embedder' ? 'Embedder' : 'Reranker',
        description: entry.filename,
        kind,
        filename: entry.filename,
        url: entry.url,
        sizeBytes: entry.sizeBytes,
        ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
        required: true,
      },
    ]
  })
}

/** Known IDs only: the renderer cannot supply a path or download URL. */
export function getDownloadManifestEntry(id: string): ModelManifestEntry | undefined {
  return getActiveModelManifest().find((entry) => entry.id === id) ?? getManifestEntry(id)
}
