import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AuthStatus } from '@shared/authTypes'
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

  it('removes revealed recovery words when the active vault explicitly locks', async () => {
    let emit!: (status: AuthStatus) => void
    vi.spyOn(window.api.auth, 'onState').mockImplementation((listener) => {
      emit = listener
      return () => {}
    })
    const registered: AuthStatus = {
      registered: true,
      locked: false,
      displayName: 'Test Account',
      remainingRecoveryCodes: 1,
      recoveryLang: 'en',
    }
    vi.spyOn(window.api.auth, 'register').mockImplementation(async () => {
      emit(registered)
      return { passphrase: Array(18).fill('synthetic-recovery-word') as string[] }
    })
    render(<App />)
    await screen.findByRole('heading', { name: /create account/i })
    fireEvent.change(screen.getByLabelText(/^Display name/), { target: { value: 'Test Account' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'SyntheticPass123!' } })
    fireEvent.change(screen.getByLabelText(/^Repeat password/), {
      target: { value: 'SyntheticPass123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findAllByText('synthetic-recovery-word')).toHaveLength(18)

    await act(async () => emit(registered))
    expect(screen.getAllByText('synthetic-recovery-word')).toHaveLength(18)

    await act(async () => emit({ ...registered, locked: true }))

    expect(screen.queryAllByText('synthetic-recovery-word')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /^Unlock/ })).toBeInTheDocument()
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
