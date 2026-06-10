import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveWhisperModel, getDiarizationModelPaths } from '@main/services/transcription/paths'

// In the vitest (no-electron) context, getModelSearchDirs() resolves to
// [<cwd>/models], matching dev behavior.
const modelsDir = join(process.cwd(), 'models')

describe('transcription paths', () => {
  it('resolves diarization model paths under the models search dir', () => {
    expect(getDiarizationModelPaths()).toEqual({
      segmentation: join(modelsDir, 'diarize-segmentation.onnx'),
      embedding: join(modelsDir, 'diarize-embedding.onnx'),
    })
  })

  it('returns null for a whisper model that is not installed', () => {
    expect(resolveWhisperModel('medium')).toBeNull()
  })
})
