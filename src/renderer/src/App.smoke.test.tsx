import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { refreshSettings } from './settings/useSettings'
import { App } from './App'

describe('App (smoke)', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await act(() => refreshSettings())
  })
  it('renders the LokLM brand', () => {
    render(<App />)
    // brand shows up in both the titlebar and the in-content header.
    expect(screen.getAllByText('LokLM').length).toBeGreaterThan(0)
  })

  it('shows the register view when no user is registered', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /create account/i })).toBeInTheDocument()
    })
  })

  it('opens a saved personal start view without waiting for AI models', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.basic.language = 'en'
    settings.basic.startView = 'notes'
    vi.spyOn(window.api.settings, 'get').mockResolvedValue(settings)
    const status = await window.api.auth.status()
    vi.spyOn(window.api.auth, 'status').mockResolvedValue({
      ...status,
      registered: true,
      locked: false,
    })
    render(<App />)
    // This checks independence from model warmup, not Vitest's lazy-module
    // transformation speed when the full suite runs in parallel.
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(await screen.findByRole('heading', { name: 'Notes', level: 1 })).toBeVisible()
    expect(screen.queryByText('Preparing your AI tools')).toBeNull()
  })
})
