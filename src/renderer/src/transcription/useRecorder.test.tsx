import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRecorder } from './useRecorder'

let recordings: FakeRecorder[]
let failStart: boolean
class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    recordings.push(this)
  }
  start() {
    if (failStart) throw new Error('device unavailable')
    this.state = 'recording'
  }
  stop = vi.fn(() => {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['clip']) })
    this.onstop?.()
  })
}

beforeEach(() => {
  recordings = []
  failStart = false
  vi.stubGlobal('MediaRecorder', FakeRecorder)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function microphone() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  let grant!: (stream: MediaStream) => void
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        grant = resolve
      }),
  )
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  return { stop, stream, getUserMedia, grant: () => grant(stream) }
}

it('releases a permission grant arriving after unmount without starting recording', async () => {
  const mic = microphone()
  const onClip = vi.fn()
  const hook = renderHook(() => useRecorder(onClip))
  act(() => hook.result.current.toggleRecord())
  expect(hook.result.current.preparing).toBe(true)
  hook.unmount()
  await act(async () => mic.grant())
  expect(mic.stop).toHaveBeenCalledOnce()
  expect(recordings).toHaveLength(0)
  expect(onClip).not.toHaveBeenCalled()
})

it('deduplicates pending permission requests and ignores a grant after the tab hides', async () => {
  const mic = microphone()
  const hook = renderHook(({ active }) => useRecorder(vi.fn(), active), {
    initialProps: { active: true },
  })
  act(() => {
    hook.result.current.toggleRecord()
    hook.result.current.toggleRecord()
  })
  expect(mic.getUserMedia).toHaveBeenCalledOnce()
  hook.rerender({ active: false })
  await act(async () => mic.grant())
  expect(mic.stop).toHaveBeenCalledOnce()
  expect(recordings).toHaveLength(0)
  expect(hook.result.current.preparing).toBe(false)
})

it('disposes active recording on unmount without starting transcription', async () => {
  vi.useFakeTimers()
  const mic = microphone()
  const onClip = vi.fn()
  const hook = renderHook(() => useRecorder(onClip))
  act(() => hook.result.current.toggleRecord())
  await act(async () => mic.grant())
  expect(hook.result.current.recording).toBe(true)
  hook.unmount()
  expect(recordings[0]!.stop).toHaveBeenCalledOnce()
  expect(mic.stop).toHaveBeenCalledOnce()
  expect(onClip).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('flushes an existing recording when its tab is hidden', async () => {
  const mic = microphone()
  const onClip = vi.fn()
  const hook = renderHook(({ active }) => useRecorder(onClip, active), {
    initialProps: { active: true },
  })
  act(() => hook.result.current.toggleRecord())
  await act(async () => mic.grant())
  hook.rerender({ active: false })
  expect(onClip).toHaveBeenCalledOnce()
  expect(mic.stop).toHaveBeenCalledOnce()
  expect(hook.result.current.recording).toBe(false)
})

it('releases acquired tracks when the recorder cannot start', async () => {
  const mic = microphone()
  failStart = true
  const hook = renderHook(() => useRecorder(vi.fn()))
  act(() => hook.result.current.toggleRecord())
  await act(async () => mic.grant())
  expect(mic.stop).toHaveBeenCalledOnce()
  expect(hook.result.current.recordError).toBe('tx.recFailed')
  expect(hook.result.current.preparing).toBe(false)
})

it('ignores callbacks from a failed recorder after a new recording starts', async () => {
  const first = microphone()
  const onClip = vi.fn()
  const hook = renderHook(() => useRecorder(onClip))
  act(() => hook.result.current.toggleRecord())
  await act(async () => first.grant())
  const retired = recordings[0]!
  const lateError = retired.onerror!
  const lateStop = retired.onstop!
  act(() => lateError())
  expect(first.stop).toHaveBeenCalledOnce()
  expect(retired.stop).toHaveBeenCalledOnce()
  expect(retired.ondataavailable).toBeNull()
  expect(retired.onerror).toBeNull()
  expect(retired.onstop).toBeNull()

  const second = microphone()
  act(() => hook.result.current.toggleRecord())
  await act(async () => second.grant())
  act(() => {
    lateError()
    lateStop()
  })
  expect(second.stop).not.toHaveBeenCalled()
  expect(recordings[1]!.state).toBe('recording')
  expect(hook.result.current.recording).toBe(true)
  expect(onClip).not.toHaveBeenCalled()
})
