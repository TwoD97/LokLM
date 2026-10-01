import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
    const { tempPath } = await stager.commit(id)
    expect(Array.from(readFileSync(tempPath))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('cleans up the temp file', async () => {
    const stager = new AudioStager(dir)
    const id = stager.begin()
    await stager.chunk(id, new Uint8Array([1, 2, 3, 4]))
    const { tempPath } = await stager.commit(id)
    await stager.cleanup(id)
    expect(() => readFileSync(tempPath)).toThrow()
  })

  it('throws for an unknown audioId', async () => {
    const stager = new AudioStager(dir)
    await expect(stager.chunk('nope', new Uint8Array([1]))).rejects.toThrow('unknown audioId')
  })

  it('uses different file identities for app instances sharing a temp directory', async () => {
    const first = new AudioStager(dir)
    const second = new AudioStager(dir)
    const firstId = first.begin()
    const secondId = second.begin()
    expect(firstId).not.toBe(secondId)
    await first.chunk(firstId, new Uint8Array([1]))
    await second.chunk(secondId, new Uint8Array([2]))
    const [a, b] = await Promise.all([first.commit(firstId), second.commit(secondId)])
    expect(Array.from(readFileSync(a.tempPath))).toEqual([1])
    expect(Array.from(readFileSync(b.tempPath))).toEqual([2])
    await Promise.all([first.cleanupAll(), second.cleanupAll()])
    expect(readdirSync(dir)).toEqual([])
  })

  it('cleans an upload that is still opening and rejects use of an uncommitted file', async () => {
    const stager = new AudioStager(dir)
    const id = stager.begin()
    expect(() => stager.pathFor(id)).toThrow('not been committed')
    await stager.cleanup(id)
    expect(readdirSync(dir)).toEqual([])
    expect(() => stager.pathFor(id)).toThrow('unknown audioId')
  })

  it('handles an asynchronous open failure between staging calls without an unhandled error', async () => {
    const stager = new AudioStager(dir)
    rmSync(dir, { recursive: true, force: true })
    const id = stager.begin()
    await new Promise<void>((resolve) => setImmediate(resolve))
    await expect(stager.commit(id)).rejects.toThrow(/ENOENT/)
    await stager.cleanupAll()
  })

  it('shares commit completion and rejects further chunks without deleting the committed audio', async () => {
    const stager = new AudioStager(dir)
    const id = stager.begin()
    await stager.chunk(id, new Uint8Array([4, 5]))
    const results = await Promise.all([stager.commit(id), stager.commit(id)])
    expect(results[0]).toEqual(results[1])
    await expect(stager.chunk(id, new Uint8Array([6]))).rejects.toThrow('closed for writes')
    expect(Array.from(readFileSync(stager.pathFor(id)))).toEqual([4, 5])
    await stager.cleanup(id)
  })
})
