import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { BasicTab } from './BasicTab'
import { useSettings } from './useSettings'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('replaces a failed initial load with a retry and hydrates existing consumers', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.basic.language = 'en'
  const get = vi
    .spyOn(window.api.settings, 'get')
    .mockRejectedValueOnce(new Error('vault unavailable'))
    .mockResolvedValue(settings)
  render(<BasicTab />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be loaded')
  expect(get).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('radiogroup', { name: 'Interface language' })).toBeVisible()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(get).toHaveBeenCalledTimes(2)
})

it('keeps the saved indication for the latest completed save and cleans its timer on unmount', async () => {
  vi.useFakeTimers()
  vi.spyOn(window.api.settings, 'update').mockResolvedValue(structuredClone(DEFAULT_SETTINGS))
  const hook = renderHook(() => useSettings())
  await act(async () => hook.result.current.update({ basic: { theme: 'dark' } }))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  await act(async () => hook.result.current.update({ basic: { theme: 'light' } }))
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(hook.result.current.savedFlash).toBe(true)
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
