import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptionEvent, TranscriptionOptions } from '@shared/transcription'
vi.mock('electron', () => ({ app: { getPath: () => 'unused' } }))
vi.mock('@main/services/transcription/paths', () => ({
  resolveWhisperModel: () => 'whisper.bin',
  getDiarizationModelPaths: () => ({ segmentation: 'seg.onnx', embedding: 'embed.onnx' }),
}))
import { TranscriptionService } from '@main/services/transcription/TranscriptionService'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'loklm-audio-lifecycle-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const options: TranscriptionOptions = {
  model: 'base',
  task: 'transcribe',
  language: 'en',
  diarize: true,
  gpu: true,
}
const result = { segments: [{ start: 0, end: 1, text: 'Private transcript' }] }

function fixture() {
  const transcription = deferred<typeof result>()
  let progress!: (done: number, total: number) => void
  const unsubscribe = vi.fn()
  const whisper = {
    transcribe: vi.fn().mockReturnValue(transcription.promise),
    registerProgress: vi.fn((_id: string, callback: typeof progress) => {
      progress = callback
      return unsubscribe
    }),
    reset: vi.fn(async () => {
      transcription.reject(new Error('worker stopped'))
    }),
  }
  const diar = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    registerProgress: vi.fn().mockReturnValue(vi.fn()),
    diarize: vi.fn().mockResolvedValue({ turns: [] }),
    reset: vi.fn().mockResolvedValue(undefined),
  }
  const service = new TranscriptionService(whisper as never, diar as never, dir)
  const events: TranscriptionEvent[] = []
  const stage = async (): Promise<string> => {
    const id = service.stager.begin()
    await service.stager.chunk(id, new Uint8Array([0, 0, 0, 0]))
    await service.stager.commit(id)
    return id
  }
  return {
    service,
    stage,
    events,
    whisper,
    diar,
    transcription,
    unsubscribe,
    progress: (done: number) => progress(done, 100),
  }
}

describe('transcription cancellation and session isolation', () => {
  it.each(['resolve', 'reject'] as const)(
    'drops late progress/content when cancelled before the native call %s',
    async (outcome) => {
      const f = fixture()
      const id = await f.stage()
      const run = f.service.run('stream', id, options, (event) => f.events.push(event))
      f.service.cancel('stream')
      f.progress(80)
      if (outcome === 'resolve') f.transcription.resolve(result)
      else f.transcription.reject(new Error('native failed after cancel'))
      await run
      expect(f.events).toEqual([{ type: 'done', segments: [] }])
      expect(f.diar.ensureLoaded).not.toHaveBeenCalled()
      expect(f.unsubscribe).toHaveBeenCalledOnce()
      expect(readdirSync(dir)).toEqual([])
    },
  )

  it('does not run diarization after cancellation while its model is loading', async () => {
    const f = fixture()
    const loading = deferred<void>()
    f.diar.ensureLoaded.mockReturnValue(loading.promise)
    const run = f.service.run('stream', await f.stage(), options, (event) => f.events.push(event))
    f.transcription.resolve(result)
    await vi.waitFor(() => expect(f.diar.ensureLoaded).toHaveBeenCalledOnce())
    f.service.cancel('stream')
    loading.resolve()
    await run
    expect(f.diar.diarize).not.toHaveBeenCalled()
    expect(f.events.at(-1)).toEqual({ type: 'done', segments: [] })
    expect(f.events.filter((event) => event.type === 'done')).toHaveLength(1)
  })

  it('coalesces session resets, terminates native work, and removes uncommitted staging too', async () => {
    const f = fixture()
    const stop = deferred<void>()
    f.whisper.reset.mockImplementation(async () => {
      await stop.promise
      f.transcription.reject(new Error('worker stopped'))
    })
    const id = await f.stage()
    const run = f.service.run('stream', id, options, (event) => f.events.push(event))
    f.service.stager.begin()
    const first = f.service.resetSession()
    const second = f.service.resetSession()
    expect(first).toBe(second)
    await expect(f.service.run('new', id, options, () => {})).rejects.toThrow('session is closing')
    f.progress(99)
    stop.resolve()
    await Promise.all([first, second, run])
    expect(f.whisper.reset).toHaveBeenCalledOnce()
    expect(f.diar.reset).toHaveBeenCalledOnce()
    expect(f.events).toEqual([{ type: 'done', segments: [] }])
    expect(readdirSync(dir)).toEqual([])
    const nextId = await f.stage()
    f.whisper.transcribe.mockResolvedValue(result)
    await f.service.run('next', nextId, { ...options, diarize: false }, (event) =>
      f.events.push(event),
    )
    expect(f.events.at(-1)).toEqual({ type: 'done', segments: result.segments })
  })

  it('rejects duplicate stream/audio ownership without deleting another active run', async () => {
    const f = fixture()
    const firstId = await f.stage()
    const secondId = await f.stage()
    const run = f.service.run('stream', firstId, options, (event) => f.events.push(event))
    await expect(f.service.run('stream', secondId, options, () => {})).rejects.toThrow(
      'stream is already running',
    )
    await expect(f.service.run('other', firstId, options, () => {})).rejects.toThrow(
      'already being transcribed',
    )
    expect(f.service.stager.pathFor(firstId)).toBeTruthy()
    f.transcription.resolve(result)
    await run
    await f.service.stager.cleanup(secondId)
  })
})
