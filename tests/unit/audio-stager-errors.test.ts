import { Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), rm: vi.fn() }))
vi.mock('node:fs', () => ({ createWriteStream: mocks.create, mkdirSync: vi.fn() }))
vi.mock('node:fs/promises', () => ({ rm: mocks.rm }))
import { AudioStager } from '@main/services/transcription/AudioStager'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rm.mockResolvedValue(undefined)
})

describe('audio write failure and file handle lifecycle', () => {
  it('rejects a backpressured chunk if disk writing fails before drain', async () => {
    let write!: (error?: Error | null) => void
    const stream = new Writable({
      highWaterMark: 1,
      write(_bytes, _encoding, done) {
        write = done
      },
    })
    mocks.create.mockReturnValue(stream)
    const stager = new AudioStager('unused')
    const id = stager.begin()
    const chunk = stager.chunk(id, new Uint8Array(1024))
    const rejected = expect(chunk).rejects.toThrow('disk full')
    write(new Error('disk full'))
    await rejected
    expect(stream.closed).toBe(true)
    expect(mocks.rm).toHaveBeenCalledOnce()
  })

  it('rejects a pending chunk on premature close and waits for close before removing its file', async () => {
    let close!: (error?: Error | null) => void
    const stream = new Writable({
      highWaterMark: 1,
      write() {},
      destroy(_error, done) {
        close = done
      },
    })
    mocks.create.mockReturnValue(stream)
    const stager = new AudioStager('unused')
    const id = stager.begin()
    const chunk = stager.chunk(id, new Uint8Array(1024))
    const rejected = expect(chunk).rejects.toThrow(/closed/)
    const cleanup = stager.cleanup(id)
    expect(mocks.rm).not.toHaveBeenCalled()
    close()
    await Promise.all([cleanup, rejected])
    expect(mocks.rm).toHaveBeenCalledOnce()
  })

  it('does not publish the committed path until the file handle has closed', async () => {
    let close!: (error?: Error | null) => void
    const stream = new Writable({
      write(_bytes, _encoding, done) {
        done()
      },
      destroy(_error, done) {
        close = done
      },
    })
    mocks.create.mockReturnValue(stream)
    const stager = new AudioStager('unused')
    const id = stager.begin()
    const committed = vi.fn()
    const commit = stager.commit(id).then(committed)
    await vi.waitFor(() => expect(stream.writableFinished).toBe(true))
    expect(committed).not.toHaveBeenCalled()
    expect(() => stager.pathFor(id)).toThrow('not been committed')
    close()
    await commit
    expect(committed).toHaveBeenCalledOnce()
    await stager.cleanup(id)
  })
})
