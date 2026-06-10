import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WhisperModelId } from '@shared/transcription'
import { WHISPER_MODELS } from './modelCatalog'
import { getModelSearchDirs } from '../models/paths'

// The installer wizard downloads whisper (.bin) + diarization (.onnx) models
// into <install-dir>/models/ alongside the GGUFs (it only prunes stale .gguf),
// so transcription assets resolve through the exact same search dirs as the
// LLM/embedder/reranker — install-dir, userData, resourcesPath, or <cwd> in dev.
export const DIARIZATION_SEGMENTATION_FILE = 'diarize-segmentation.onnx'
export const DIARIZATION_EMBEDDING_FILE = 'diarize-embedding.onnx'

/** Resolve a whisper model id to an absolute path, or null if not installed. */
export function resolveWhisperModel(id: WhisperModelId): string | null {
  const file = WHISPER_MODELS[id].file
  for (const dir of getModelSearchDirs()) {
    const p = join(dir, file)
    if (existsSync(p)) return p
  }
  return null
}

/** Absolute paths to the diarization models. Prefers the first search dir that
 *  actually holds the segmentation model; falls back to the primary dir. */
export function getDiarizationModelPaths(): { segmentation: string; embedding: string } {
  for (const dir of getModelSearchDirs()) {
    if (existsSync(join(dir, DIARIZATION_SEGMENTATION_FILE))) {
      return {
        segmentation: join(dir, DIARIZATION_SEGMENTATION_FILE),
        embedding: join(dir, DIARIZATION_EMBEDDING_FILE),
      }
    }
  }
  const d = getModelSearchDirs()[0]!
  return {
    segmentation: join(d, DIARIZATION_SEGMENTATION_FILE),
    embedding: join(d, DIARIZATION_EMBEDDING_FILE),
  }
}
