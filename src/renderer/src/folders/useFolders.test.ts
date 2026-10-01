import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFolders } from './useFolders'

afterEach(() => vi.restoreAllMocks())
type Listing = Awaited<ReturnType<typeof window.api.folders.list>>
const listing = (name: string): Listing => ({
  folders: [{ id: 1, name, parentId: null, createdAt: 1 }],
  assignments: [],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('workspace folder state', () => {
  it('drops a late result from the previous workspace, including colliding folder IDs', async () => {
    const previous = deferred<Listing>()
    vi.spyOn(window.api.folders, 'list')
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce(listing('Current folder'))
    const hook = renderHook(({ id }) => useFolders(id), { initialProps: { id: 1 } })
    hook.rerender({ id: 2 })
    await waitFor(() => expect(hook.result.current.folders[0]?.name).toBe('Current folder'))
    await act(async () => previous.resolve(listing('Wrong old folder')))
    expect(hook.result.current.folders[0]?.name).toBe('Current folder')
  })

  it('keeps a newer refresh when the initial snapshot arrives last', async () => {
    const initial = deferred<Listing>()
    vi.spyOn(window.api.folders, 'list')
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(listing('Newest folder'))
    const hook = renderHook(() => useFolders(1))
    await act(async () => hook.result.current.refresh())
    await act(async () => initial.resolve(listing('Stale folder')))
    expect(hook.result.current.folders[0]?.name).toBe('Newest folder')
  })

  it('clears the previous data immediately while a different workspace is loading', async () => {
    const next = deferred<Listing>()
    vi.spyOn(window.api.folders, 'list')
      .mockResolvedValueOnce(listing('Old folder'))
      .mockReturnValueOnce(next.promise)
    const hook = renderHook(({ id }) => useFolders(id), { initialProps: { id: 1 } })
    await waitFor(() => expect(hook.result.current.folders).toHaveLength(1))
    hook.rerender({ id: 2 })
    expect(hook.result.current.folders).toEqual([])
    await act(async () => next.resolve(listing('Current folder')))
  })

  it('surfaces initial load failures and clears them on successful retry', async () => {
    vi.spyOn(window.api.folders, 'list')
      .mockRejectedValueOnce(new Error('Store unavailable'))
      .mockResolvedValueOnce(listing('Recovered'))
    const hook = renderHook(() => useFolders(1))
    await waitFor(() => expect(hook.result.current.error).toBe('Store unavailable'))
    await act(async () => hook.result.current.refresh())
    expect(hook.result.current.error).toBeNull()
    expect(hook.result.current.folders[0]?.name).toBe('Recovered')
  })

  it('retains visible action failures instead of leaking rejected fire-and-forget promises', async () => {
    vi.spyOn(window.api.folders, 'list').mockResolvedValue(listing('Existing'))
    vi.spyOn(window.api.folders, 'rename').mockRejectedValue(new Error('Rename denied'))
    const hook = renderHook(() => useFolders(1))
    await waitFor(() => expect(hook.result.current.folders).toHaveLength(1))
    await act(async () => hook.result.current.renameFolder(1, 'New name'))
    expect(hook.result.current.error).toBe('Rename denied')
    expect(hook.result.current.folders[0]?.name).toBe('Existing')
  })

  it('does not reload an old workspace when its mutation finishes after navigation', async () => {
    const mutation = deferred<void>()
    const list = vi
      .spyOn(window.api.folders, 'list')
      .mockResolvedValueOnce(listing('Old folder'))
      .mockResolvedValueOnce(listing('New folder'))
    vi.spyOn(window.api.folders, 'rename').mockReturnValue(mutation.promise)
    const hook = renderHook(({ id }) => useFolders(id), { initialProps: { id: 1 } })
    await waitFor(() => expect(hook.result.current.folders).toHaveLength(1))
    let operation!: Promise<void>
    act(() => {
      operation = hook.result.current.renameFolder(1, 'Changed old folder')
    })
    hook.rerender({ id: 2 })
    await act(async () => {
      mutation.resolve()
      await operation
    })
    expect(list.mock.calls).toEqual([[1], [2]])
    expect(hook.result.current.folders[0]?.name).toBe('New folder')
  })
})
