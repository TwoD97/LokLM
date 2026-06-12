import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { LlmProfileChoice } from '@shared/documents'

// AP-9 §3.8: switching the model profile must trigger a model reload — but
// guarded by a confirmation so a stray click doesn't kick off a multi-GB
// unload+reload. We mock useSettings (which BasicTab AND useT both read) so the
// UI renders in English with a controllable current profile + an update spy.
const h = vi.hoisted(() => ({
  update: vi.fn(async () => {}),
  profile: 'auto' as LlmProfileChoice,
}))

vi.mock('./useSettings', () => ({
  useSettings: () => ({
    settings: {
      ...DEFAULT_SETTINGS,
      basic: { ...DEFAULT_SETTINGS.basic, language: 'en', llmProfile: h.profile },
    },
    update: h.update,
    savedFlash: false,
  }),
}))

import { BasicTab } from './BasicTab'

describe('BasicTab — model profile reload confirmation', () => {
  beforeEach(() => {
    h.update.mockClear()
    h.profile = 'lite'
  })

  it('prompts for confirmation before applying a profile switch', async () => {
    const reload = vi.spyOn(window.api.llm, 'reload')
    render(<BasicTab />)
    // The 'Auto' card is always available; clicking it from 'lite' is a switch.
    fireEvent.click(screen.getByRole('button', { name: /Auto/ }))
    expect(await screen.findByText('Reload model?')).toBeInTheDocument()
    // Nothing happens until the user confirms.
    expect(h.update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('applies the profile and reloads the model on confirm', async () => {
    const reload = vi.spyOn(window.api.llm, 'reload')
    render(<BasicTab />)
    fireEvent.click(screen.getByRole('button', { name: /Auto/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Switch & reload' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ basic: { llmProfile: 'auto' } }))
    expect(reload).toHaveBeenCalled()
  })

  it('does nothing when the switch is cancelled', async () => {
    const reload = vi.spyOn(window.api.llm, 'reload')
    render(<BasicTab />)
    fireEvent.click(screen.getByRole('button', { name: /Auto/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(h.update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
