import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

const gate = vi.hoisted(() => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return { ready, release, loaded: vi.fn() }
})
vi.mock('../library/LibraryView', () => ({ LibraryView: () => <p>Light library route</p> }))
vi.mock('../writing/WritingView', async () => {
  gate.loaded()
  await gate.ready
  return {
    WritingView: () => (
      <label>
        Lazy draft
        <textarea />
      </label>
    ),
  }
})
afterEach(() => vi.restoreAllMocks())

it('loads optional routes on demand, keeps navigation usable while loading, and preserves a visited draft', async () => {
  vi.spyOn(window.api.workspaces, 'list').mockResolvedValue([
    { id: 1, name: 'Workspace', createdAt: 0, type: 'library', encryptionLevel: 'full' },
  ])
  render(<AppShell />)
  await screen.findByText('Light library route')
  expect(gate.loaded).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Write' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Loading')
  fireEvent.click(screen.getByRole('button', { name: 'Library' }))
  expect(await screen.findByText('Light library route')).toBeVisible()
  await act(async () => gate.release())
  fireEvent.click(screen.getByRole('button', { name: 'Write' }))
  const draft = await screen.findByRole('textbox', { name: 'Lazy draft' })
  fireEvent.change(draft, { target: { value: 'Keep my draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Library' }))
  await screen.findByText('Light library route')
  fireEvent.click(screen.getByRole('button', { name: 'Write' }))
  expect(screen.getByRole('textbox', { name: 'Lazy draft' })).toHaveValue('Keep my draft')
  expect(gate.loaded).toHaveBeenCalledOnce()
})
