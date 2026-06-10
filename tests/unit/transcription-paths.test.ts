import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import {
  getWhisperDir,
  getDiarizationDir,
  getDiarizationModelPaths,
} from '@main/services/transcription/paths'

describe('transcription paths (no-electron context)', () => {
  beforeEach(() => {
    delete process.env['LOKLM_WHISPER_DIR']
    delete process.env['LOKLM_DIARIZATION_DIR']
  })

  it('falls back to <cwd>/whisper and <cwd>/diarization', () => {
    expect(getWhisperDir()).toBe(join(process.cwd(), 'whisper'))
    expect(getDiarizationDir()).toBe(join(process.cwd(), 'diarization'))
  })

  it('honors the override env vars', () => {
    process.env['LOKLM_WHISPER_DIR'] = '/tmp/w'
    process.env['LOKLM_DIARIZATION_DIR'] = '/tmp/d'
    expect(getWhisperDir()).toBe('/tmp/w')
    expect(getDiarizationModelPaths()).toEqual({
      segmentation: join('/tmp/d', 'segmentation.onnx'),
      embedding: join('/tmp/d', 'embedding.onnx'),
    })
  })
})
