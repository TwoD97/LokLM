import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TranscriptionEvent, TranscriptionOptions } from '@shared/transcription'
import { useTranscription } from './useTranscription'
import { decodeToMono16k, type DecodedAudio } from '../audio/decode'

vi.mock('../audio/decode', () => ({ decodeToMono16k: vi.fn() }))
const jobs = vi.hoisted(() => ({ begin: vi.fn(), end: vi.fn() }))
vi.mock('../generation/GenerationContext', () => ({ useGeneration: () => ({ begin: jobs.begin }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const options: TranscriptionOptions = {
  task: 'transcribe',
  language: 'auto',
  model: 'base',
  diarize: false,
}
const audio: DecodedAudio = { pcm: new Uint8Array(4), durationSec: 1 }
let emit: (event: TranscriptionEvent) => void
let off: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  jobs.begin.mockReset().mockReturnValue(jobs.end)
  jobs.end.mockReset()
  vi.mocked(decodeToMono16k).mockReset().mockResolvedValue(audio)
  off = vi.fn()
  vi.spyOn(window.api.transcription, 'onEvent').mockImplementation((_id, callback) => {
    emit = callback
    return off
  })
  vi.spyOn(window.api.transcription, 'stageBegin').mockResolvedValue('stage-1')
  vi.spyOn(window.api.transcription, 'stageChunk').mockResolvedValue()
  vi.spyOn(window.api.transcription, 'stageCommit').mockResolvedValue({
    audioId: 'stage-1',
    durationSec: 1,
  })
  vi.spyOn(window.api.transcription, 'discardStage').mockResolvedValue()
  vi.spyOn(window.api.transcription, 'cancel').mockResolvedValue()
  vi.spyOn(window.api.transcription, 'run').mockImplementation(async () => {
    emit({ type: 'done', segments: [{ start: 0, end: 1, text: 'Transcript' }] })
  })
})
afterEach(() => vi.restoreAllMocks())

it('does not stage decoded audio after cancellation', async () => {
  const decoding = deferred<DecodedAudio>()
  vi.mocked(decodeToMono16k).mockReturnValue(decoding.promise)
  const hook = renderHook(() => useTranscription())
  let task!: Promise<void>
  act(() => {
    task = hook.result.current.transcribe(new ArrayBuffer(1), options)
  })
  act(() => hook.result.current.cancel())
  await act(async () => {
    decoding.resolve(audio)
    await task
  })
  expect(window.api.transcription.stageBegin).not.toHaveBeenCalled()
  expect(hook.result.current.state.phase).toBe('cancelled')
  expect(jobs.end).toHaveBeenCalledOnce()
})

it('discards partially staged audio without committing or running it', async () => {
  const chunk = deferred<void>()
  vi.mocked(window.api.transcription.stageChunk).mockReturnValue(chunk.promise)
  const hook = renderHook(() => useTranscription())
  let task!: Promise<void>
  await act(async () => {
    task = hook.result.current.transcribe(new ArrayBuffer(1), options)
  })
  expect(window.api.transcription.stageChunk).toHaveBeenCalledOnce()
  act(() => hook.result.current.cancel())
  await act(async () => {
    chunk.resolve()
    await task
  })
  expect(window.api.transcription.discardStage).toHaveBeenCalledWith('stage-1')
  expect(window.api.transcription.stageCommit).not.toHaveBeenCalled()
  expect(window.api.transcription.run).not.toHaveBeenCalled()
})

it('cancels an active batch once and never reads the remaining files', async () => {
  const running = deferred<void>()
  vi.mocked(window.api.transcription.run).mockReturnValue(running.promise)
  const first = {
    name: 'one.wav',
    arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
  } as unknown as File
  const second = {
    name: 'two.wav',
    arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
  } as unknown as File
  const hook = renderHook(() => useTranscription())
  let task!: Promise<void>
  await act(async () => {
    task = hook.result.current.transcribeMany([first, second], options)
  })
  act(() => {
    hook.result.current.cancel()
    hook.result.current.cancel()
  })
  expect(hook.result.current.cancelling).toBe(true)
  expect(window.api.transcription.cancel).toHaveBeenCalledOnce()
  await act(async () => {
    emit({ type: 'done', segments: [] })
    running.resolve()
    await task
  })
  expect(second.arrayBuffer).not.toHaveBeenCalled()
  expect(hook.result.current.queue.map((row) => row.phase)).toEqual(['cancelled', 'cancelled'])
  expect(hook.result.current.cancelling).toBe(false)
  expect(jobs.end).toHaveBeenCalledOnce()
})

it('releases subscriptions on unmount and keeps activity until native cleanup finishes', async () => {
  const running = deferred<void>()
  vi.mocked(window.api.transcription.run).mockReturnValue(running.promise)
  const hook = renderHook(() => useTranscription())
  let task!: Promise<void>
  await act(async () => {
    task = hook.result.current.transcribe(new ArrayBuffer(1), options)
  })
  hook.unmount()
  expect(off).toHaveBeenCalled()
  expect(window.api.transcription.cancel).toHaveBeenCalledOnce()
  expect(jobs.end).not.toHaveBeenCalled()
  await act(async () => {
    running.resolve()
    await task
  })
  expect(jobs.end).toHaveBeenCalledOnce()
})

it('keeps terminal output after successful native completion', async () => {
  const hook = renderHook(() => useTranscription())
  await act(async () => hook.result.current.transcribe(new ArrayBuffer(1), options))
  expect(hook.result.current.state).toMatchObject({
    phase: 'done',
    segments: [{ text: 'Transcript' }],
  })
  expect(window.api.transcription.discardStage).not.toHaveBeenCalled()
  expect(off).toHaveBeenCalledOnce()
})

it('reports a missing terminal event instead of staying busy forever', async () => {
  vi.mocked(window.api.transcription.run).mockResolvedValue()
  const hook = renderHook(() => useTranscription())
  await act(async () => hook.result.current.transcribe(new ArrayBuffer(1), options))
  expect(hook.result.current.state).toMatchObject({
    phase: 'error',
    error: 'Transcription ended without a result.',
  })
  expect(jobs.end).toHaveBeenCalledOnce()
})
