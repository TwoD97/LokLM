import { describe, it, expect } from 'vitest'
import { WHISPER_MODELS, modelEntry } from '@main/services/transcription/modelCatalog'

describe('whisper model catalog', () => {
  it('marks base as bundled and the rest as downloadable', () => {
    expect(WHISPER_MODELS.base.bundled).toBe(true)
    expect(WHISPER_MODELS.tiny.bundled).toBe(false)
    expect(WHISPER_MODELS.small.bundled).toBe(false)
    expect(WHISPER_MODELS.medium.bundled).toBe(false)
  })
  it('every entry has a non-empty file, https url, 64-hex sha256 and positive bytes', () => {
    for (const id of ['tiny', 'base', 'small', 'medium'] as const) {
      const e = modelEntry(id)
      expect(e.file.length).toBeGreaterThan(0)
      expect(e.url.startsWith('https://')).toBe(true)
      expect(e.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(e.bytes).toBeGreaterThan(0)
    }
  })
})
