import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { WhisperModelId } from '@shared/transcription'
import { WHISPER_MODELS } from './modelCatalog'

type ElectronApp = { isPackaged: boolean; getPath: (n: string) => string }
let cachedApp: ElectronApp | null | undefined
function getAppOrNull(): ElectronApp | null {
  if (cachedApp !== undefined) return cachedApp
  try {
    const mod = createRequire(import.meta.url)('electron') as { app?: ElectronApp }
    cachedApp = mod && typeof mod === 'object' && mod.app ? mod.app : null
  } catch {
    cachedApp = null
  }
  return cachedApp
}

/**
 * Ordered list of directories to look in for a transcription asset folder.
 * Mirrors models/paths.getModelSearchDirs: the installer wizard writes the
 * downloaded whisper + diarization models next to the executable
 * (`<install-dir>/<folder>`), so that's preferred; `resourcesPath` covers any
 * bundled fallback and `userData` covers side-loads. Dev + vitest fall back to
 * `<cwd>/<folder>`. An override env var short-circuits to a single dir.
 */
function searchDirs(folder: 'whisper' | 'diarization', override: string | undefined): string[] {
  if (override) return [override]
  const app = getAppOrNull()
  if (!app || typeof app.isPackaged !== 'boolean' || !app.isPackaged) {
    return [join(process.cwd(), folder)]
  }
  return [
    join(dirname(process.execPath), folder),
    join(process.resourcesPath, folder),
    join(app.getPath('userData'), folder),
  ]
}

export function getWhisperSearchDirs(): string[] {
  return searchDirs('whisper', process.env['LOKLM_WHISPER_DIR'])
}

/** Primary whisper dir (first search location). */
export function getWhisperDir(): string {
  return getWhisperSearchDirs()[0]!
}

/** Resolve a model id to an absolute file path across the search dirs, or null. */
export function resolveWhisperModel(id: WhisperModelId): string | null {
  const file = WHISPER_MODELS[id].file
  for (const dir of getWhisperSearchDirs()) {
    const p = join(dir, file)
    if (existsSync(p)) return p
  }
  return null
}

/** First diarization dir that actually contains the segmentation model, else
 *  the primary search location. */
export function getDiarizationDir(): string {
  const dirs = searchDirs('diarization', process.env['LOKLM_DIARIZATION_DIR'])
  for (const d of dirs) {
    if (existsSync(join(d, 'segmentation.onnx'))) return d
  }
  return dirs[0]!
}

/** Absolute paths to the two diarization models. */
export function getDiarizationModelPaths(): { segmentation: string; embedding: string } {
  const dir = getDiarizationDir()
  return { segmentation: join(dir, 'segmentation.onnx'), embedding: join(dir, 'embedding.onnx') }
}
