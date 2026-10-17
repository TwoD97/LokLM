import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WhisperModelStatus } from '@shared/transcription'
import { useAppStatus } from './useAppStatus'

afterEach(() => vi.restoreAllMocks())

describe('audio status refresh ownership', () => {
  it.each(['success', 'failure'])(
    'ignores an older audio %s after a newer focus refresh',
    async (outcome) => {
      let resolve!: (value: WhisperModelStatus[]) => void
      let reject!: (reason: Error) => void
      const latest: WhisperModelStatus[] = [
        { id: 'small', present: true, downloading: false, bytes: 100 },
      ]
      vi.spyOn(window.api.transcription, 'modelStatus')
        .mockReturnValueOnce(
          new Promise((yes, no) => {
            resolve = yes
            reject = no
          }),
        )
        .mockResolvedValue(latest)
      const { result } = renderHook(() => useAppStatus())
      fireEvent.focus(window)
      await waitFor(() => expect(result.current.audio).toEqual(latest))
      await act(async () => {
        if (outcome === 'success') resolve([])
        else reject(new Error('stale read failed'))
      })
      expect(result.current.audio).toEqual(latest)
      expect(result.current.readFailed).toBe(false)
    },
  )
})
