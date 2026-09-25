import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslateResult, TranslationProgress } from '@shared/translation'
import { useTranslationRequest } from './useTranslationRequest'

afterEach(() => vi.restoreAllMocks())

function pendingRequest() {
  let resolve!: (result: TranslateResult) => void
  const promise = new Promise<TranslateResult>((r) => {
    resolve = r
  })
  vi.spyOn(window.api.translation, 'translate').mockReturnValue(promise)
  const cancel = vi.spyOn(window.api.translation, 'cancel').mockResolvedValue(undefined)
  let onProgress!: (p: TranslationProgress) => void
  const unsubscribe = vi.fn()
  vi.spyOn(window.api.translation, 'onProgress').mockImplementation((cb) => {
    onProgress = cb
    return unsubscribe
  })
  return { resolve, cancel, progress: (p: TranslationProgress) => onProgress(p), unsubscribe }
}
const output = { text: 'Hallo', detected: 'en', sentences: 1, ms: 1 }

describe('translation request lifecycle', () => {
  it('filters progress by request, cancels the correct call, and suppresses late results', async () => {
    const request = pendingRequest()
    const { result } = renderHook(() => useTranslationRequest())
    let done!: Promise<TranslateResult | null>
    act(() => {
      done = result.current.runTranslation('Hello', 'de')
    })
    const id = vi.mocked(window.api.translation.translate).mock.calls.at(-1)![1].requestId!
    act(() => request.progress({ requestId: 'another-panel', completed: 1, total: 2 }))
    expect(result.current.progress).toBeNull()
    act(() => request.progress({ requestId: id, completed: 1, total: 2 }))
    expect(result.current.progress?.completed).toBe(1)
    act(() => result.current.cancel())
    expect(request.cancel).toHaveBeenCalledWith(id)
    await act(async () => {
      request.resolve(output)
      expect(await done).toBeNull()
    })
  })
  it('cancels and unsubscribes when the panel unmounts', async () => {
    const request = pendingRequest()
    const { result, unmount } = renderHook(() => useTranslationRequest())
    let done!: Promise<TranslateResult | null>
    act(() => {
      done = result.current.runTranslation('Hello', 'de')
    })
    unmount()
    expect(request.cancel).toHaveBeenCalledOnce()
    expect(request.unsubscribe).toHaveBeenCalledOnce()
    request.resolve(output)
    expect(await done).toBeNull()
  })
  it('returns a successful result and allows another request', async () => {
    vi.spyOn(window.api.translation, 'translate').mockResolvedValue(output)
    const { result } = renderHook(() => useTranslationRequest())
    await act(async () => {
      expect(await result.current.runTranslation('Hello', 'de')).toEqual(output)
    })
    await act(async () => {
      expect(await result.current.runTranslation('Hello again', 'de')).toEqual(output)
    })
  })
})
