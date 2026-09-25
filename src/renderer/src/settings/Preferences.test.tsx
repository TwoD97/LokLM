import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type UserSettings } from '@shared/settings'
import { ModulesTab } from './ModulesTab'
import { SystemTab } from './SystemTab'
import { AppShell } from '../shell/AppShell'
import { refreshSettings } from './useSettings'

let settings: UserSettings
beforeEach(async () => {
  settings = structuredClone(DEFAULT_SETTINGS)
  settings.basic.language = 'en'
  vi.spyOn(window.api.settings, 'get').mockImplementation(async () => structuredClone(settings))
  await act(() => refreshSettings())
})
afterEach(() => vi.restoreAllMocks())

describe('Workspace preferences', () => {
  it('opens a saved organizer start view without needing a document workspace', async () => {
    settings.basic.startView = 'notes'
    settings.basic.modules.quiz = false
    await act(() => refreshSettings())
    render(<AppShell />)
    expect(await screen.findByRole('heading', { name: 'Notes', level: 1 })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Quiz' })).toBeNull()
    expect(screen.queryByText(/create or select a workspace/i)).toBeNull()
  })

  it('preserves a note draft across organizer and other module navigation', async () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    const title = await screen.findByRole('textbox', { name: 'Note title' })
    fireEvent.change(title, { target: { value: 'An unfinished idea' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('An unfinished idea')
  })

  it('leaves a module enabled and reports a failed durable save', async () => {
    vi.spyOn(window.api.settings, 'update').mockRejectedValue(new Error('disk unavailable'))
    render(<ModulesTab />)
    fireEvent.click(screen.getByRole('switch', { name: 'Calendar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(screen.getByRole('switch', { name: 'Calendar' })).toBeChecked()
  })

  it('returns safely to Library when the active module becomes hidden', async () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(await screen.findByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()
    settings.basic.modules.calendar = false
    await act(() => refreshSettings())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    )
    expect(screen.queryByRole('button', { name: 'Calendar' })).toBeNull()
  })
})

describe('Hardware guidance', () => {
  it('uses the active external provider instead of judging stale bundled model details', async () => {
    const status = await window.api.llm.status()
    vi.spyOn(window.api.llm, 'status').mockResolvedValue({
      ...status,
      state: 'ready',
      source: 'ollama',
    })
    const base = await window.api.llm.info()
    vi.spyOn(window.api.llm, 'info').mockResolvedValue({
      ...base,
      source: 'bundled',
      bundledModelExists: false,
      state: 'failed',
    })
    render(<SystemTab />)
    await screen.findByText(/Local hardware figures do not describe its capacity/)
    expect(screen.queryByText('Chat model is missing')).toBeNull()
    expect(screen.queryByText('Chat could not start')).toBeNull()
  })

  it('gives missing-model recovery actions and reports a failed preparation retry', async () => {
    const base = await window.api.llm.info()
    vi.spyOn(window.api.llm, 'info').mockResolvedValue({
      ...base,
      source: 'bundled',
      bundledModelExists: false,
    })
    vi.spyOn(window.api.models, 'warmupForQa').mockRejectedValue(new Error('worker unavailable'))
    const onOpenAdvanced = vi.fn()
    render(<SystemTab onOpenAdvanced={onOpenAdvanced} />)
    expect(await screen.findByText('Chat model is missing')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    expect(onOpenAdvanced).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Status could not be checked')
    expect(screen.getByRole('button', { name: 'Retry preparation' })).toBeEnabled()
  })

  it('explains a 4.1 GiB GPU and partial model placement using actual capacity', async () => {
    const base = await window.api.llm.info()
    vi.spyOn(window.api.llm, 'info').mockResolvedValue({
      ...base,
      totalMemGB: 64,
      resources: { hasGpu: true, totalVramGB: 4.1 },
      modelCapacity: {
        gpuLayers: 14,
        totalModelLayers: 33,
        fullyOnGpu: false,
        contextSize: 4096,
        totalVramGB: 4.1,
      },
    })
    render(<SystemTab />)
    expect(await screen.findByText('Limited GPU memory')).toBeVisible()
    expect(screen.getByText('14 / 33')).toBeVisible()
    expect(screen.getByText('64 GB')).toBeVisible()
    expect(screen.getByText(/This model does not fit entirely/)).toBeVisible()
  })

  it('does not infer GPU capacity or claim readiness from system RAM', async () => {
    const base = await window.api.llm.info()
    vi.spyOn(window.api.llm, 'info').mockResolvedValue({
      ...base,
      totalMemGB: 64,
      resources: null,
      resolvedPlacement: null,
      modelCapacity: null,
    })
    render(<SystemTab />)
    await screen.findByText('64 GB')
    expect(screen.queryByText('Limited GPU memory')).toBeNull()
    expect(screen.queryByText('GPU acceleration available')).toBeNull()
    expect(screen.getByText(/No performance rating/)).toBeVisible()
  })
})
