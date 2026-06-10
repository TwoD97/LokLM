import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AudioStager } from '@main/services/transcription/AudioStager'

describe('AudioStager', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loklm-stage-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('assembles chunks into one temp file and reports the path', async () => {
    const stager = new AudioStager(dir)
    const id = stager.begin()
    await stager.chunk(id, new Uint8Array([1, 2, 3, 4]))
    await stager.chunk(id, new Uint8Array([5, 6, 7, 8]))
    const { tempPath } = await stager.commit(id, 0.5)
    expect(Array.from(readFileSync(tempPath))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('cleans up the temp file', async () => {
    const stager = new AudioStager(dir)
    const id = stager.begin()
    await stager.chunk(id, new Uint8Array([1, 2, 3, 4]))
    const { tempPath } = await stager.commit(id, 0.1)
    stager.cleanup(id)
    expect(() => readFileSync(tempPath)).toThrow()
  })

  it('throws for an unknown audioId', async () => {
    const stager = new AudioStager(dir)
    await expect(stager.chunk('nope', new Uint8Array([1]))).rejects.toThrow('unknown audioId')
  })
})
