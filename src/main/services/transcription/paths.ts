import { existsSync } from 'node:fs'
import { join } from 'node:path'
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

function assetDir(folder: 'whisper' | 'diarization', override: string | undefined): string {
  if (override) return override
  const app = getAppOrNull()
  if (!app || typeof app.isPackaged !== 'boolean') return join(process.cwd(), folder)
  if (!app.isPackaged) return join(process.cwd(), folder)
  return join(process.resourcesPath, folder)
}

export function getWhisperDir(): string {
  return assetDir('whisper', process.env['LOKLM_WHISPER_DIR'])
}

export function getDiarizationDir(): string {
  return assetDir('diarization', process.env['LOKLM_DIARIZATION_DIR'])
}

/** Writable dir for picker-downloaded (non-bundled) whisper models. */
export function getWhisperDownloadDir(): string {
  const app = getAppOrNull()
  if (!app || typeof app.isPackaged !== 'boolean' || !app.isPackaged) {
    return join(process.cwd(), 'whisper')
  }
  return join(app.getPath('userData'), 'whisper')
}

/** Resolve a model id to an absolute file path: bundled dir first, then the
 *  download dir. Returns null if neither has it. */
export function resolveWhisperModel(id: WhisperModelId): string | null {
  const file = WHISPER_MODELS[id].file
  for (const dir of [getWhisperDir(), getWhisperDownloadDir()]) {
    const p = join(dir, file)
    if (existsSync(p)) return p
  }
  return null
}

/** Absolute paths to the two bundled diarization models. */
export function getDiarizationModelPaths(): { segmentation: string; embedding: string } {
  const dir = getDiarizationDir()
  return { segmentation: join(dir, 'segmentation.onnx'), embedding: join(dir, 'embedding.onnx') }
}
