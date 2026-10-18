import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OrganizerChangedEvent, OrganizerSnapshot, OrganizerTask } from '@shared/organizer'
import { useOrganizer } from './useOrganizer'

const empty = (): OrganizerSnapshot => ({ notes: [], tasks: [], events: [] })
const task: OrganizerTask = {
  id: 'task-1',
  revision: 1,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  title: 'Created in chat',
  dueDate: '2026-10-19',
  completed: false,
}
const change: OrganizerChangedEvent = { kind: 'tasks', id: task.id, operation: 'saved' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let changed: (event: OrganizerChangedEvent) => void
let off: ReturnType<typeof vi.fn<() => void>>
beforeEach(() => {
  off = vi.fn()
  vi.spyOn(window.api.organizer, 'onChanged').mockImplementation((callback) => {
    changed = callback
    return off
  })
  vi.spyOn(window.api.organizer, 'list').mockResolvedValue(empty())
})
afterEach(() => vi.restoreAllMocks())

it('subscribes before its initial read and fences stale reads while coalescing changes', async () => {
  const initial = deferred<OrganizerSnapshot>()
  const latest = deferred<OrganizerSnapshot>()
  vi.mocked(window.api.organizer.list)
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(latest.promise)
  const hook = renderHook(() => useOrganizer())
  await waitFor(() => expect(window.api.organizer.list).toHaveBeenCalledOnce())
  expect(vi.mocked(window.api.organizer.onChanged).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(window.api.organizer.list).mock.invocationCallOrder[0]!,
  )
  act(() => {
    changed(change)
    changed(change)
    changed(change)
  })
  await act(async () => initial.resolve(empty()))
  expect(window.api.organizer.list).toHaveBeenCalledTimes(2)
  expect(hook.result.current.loaded).toBe(false)
  await act(async () => latest.resolve({ ...empty(), tasks: [task] }))
  expect(hook.result.current.data.tasks).toEqual([task])
  expect(hook.result.current.loaded).toBe(true)
})

it('keeps loaded items visible when a background refresh fails and recovers on retry', async () => {
  vi.mocked(window.api.organizer.list)
    .mockResolvedValueOnce({ ...empty(), tasks: [task] })
    .mockRejectedValueOnce(new Error('IPC interrupted'))
    .mockResolvedValue(empty())
  const hook = renderHook(() => useOrganizer())
  await waitFor(() => expect(hook.result.current.loaded).toBe(true))
  await act(async () => changed(change))
  expect(hook.result.current.data.tasks).toEqual([task])
  expect(hook.result.current.loadError).toBeNull()
  expect(hook.result.current.refreshError).toBeInstanceOf(Error)
  expect(hook.result.current.loaded).toBe(true)
  await act(async () => hook.result.current.refresh())
  expect(hook.result.current.refreshError).toBeNull()
  expect(hook.result.current.data.tasks).toEqual([])
})

it('does not let an old refresh erase a successful local save', async () => {
  const old = deferred<OrganizerSnapshot>()
  vi.mocked(window.api.organizer.list)
    .mockResolvedValueOnce(empty())
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ ...empty(), tasks: [task] })
  vi.spyOn(window.api.organizer, 'saveTask').mockResolvedValue(task)
  const hook = renderHook(() => useOrganizer())
  await waitFor(() => expect(hook.result.current.loaded).toBe(true))
  await act(async () => changed(change))
  await act(async () =>
    hook.result.current.saveTask({ title: task.title, completed: false, dueDate: task.dueDate }),
  )
  expect(hook.result.current.data.tasks).toEqual([task])
  await act(async () => old.resolve(empty()))
  expect(hook.result.current.data.tasks).toEqual([task])
  expect(window.api.organizer.list).toHaveBeenCalledTimes(3)
})

it('unsubscribes and ignores late reads and events after disposal', async () => {
  const pending = deferred<OrganizerSnapshot>()
  vi.mocked(window.api.organizer.list).mockReturnValue(pending.promise)
  const hook = renderHook(() => useOrganizer())
  await waitFor(() => expect(window.api.organizer.list).toHaveBeenCalledOnce())
  hook.unmount()
  expect(off).toHaveBeenCalledOnce()
  await act(async () => {
    changed(change)
    pending.resolve({ ...empty(), tasks: [task] })
  })
  expect(window.api.organizer.list).toHaveBeenCalledOnce()
})
