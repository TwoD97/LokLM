import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { ProfileTab } from './ProfileTab'
import { Segmented } from './Segmented'
import { OllamaSection } from './OllamaSection'
import { LlmSection } from './sections/LlmSection'
import { TranslationSection } from './sections/TranslationSection'

afterEach(() => vi.restoreAllMocks())

describe('Personal settings workflows', () => {
  it('retries a failed translation status check instead of remaining on Loading', async () => {
    const status = vi
      .spyOn(window.api.translation, 'status')
      .mockRejectedValueOnce(new Error('IPC failed'))
      .mockResolvedValue({ state: 'ready', message: null, modelName: 'Test model' })
    render(<TranslationSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Translation status could not be loaded',
    )
    expect(screen.queryByText(/Loading/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Ready')).toBeVisible()
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('uses arrow keys for segmented settings and skips unavailable choices', () => {
    function Choice() {
      const [value, setValue] = useState('auto')
      return (
        <Segmented
          value={value}
          onChange={setValue}
          ariaLabel="Device"
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'unavailable', label: 'Unavailable', disabled: true },
            { value: 'gpu', label: 'GPU' },
          ]}
        />
      )
    }
    render(<Choice />)
    const auto = screen.getByRole('radio', { name: 'Auto' })
    auto.focus()
    fireEvent.keyDown(auto, { key: 'ArrowRight' })
    const gpu = screen.getByRole('radio', { name: 'GPU' })
    expect(gpu).toHaveFocus()
    expect(gpu).toHaveAttribute('aria-checked', 'true')
    expect(auto).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(gpu, { key: 'Home' })
    expect(auto).toHaveFocus()
    expect(auto).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps an avatar and shows an actionable error when removal cannot be saved', async () => {
    const status = await window.api.auth.status()
    vi.spyOn(window.api.auth, 'status').mockResolvedValue({ ...status, displayName: 'Alex' })
    vi.spyOn(window.api.settings, 'getAvatar').mockResolvedValue([1, 2, 3])
    vi.spyOn(window.api.settings, 'setAvatar').mockRejectedValue(new Error('Disk full'))
    render(<ProfileTab />)
    const remove = screen.getByRole('button', { name: 'Remove' })
    await waitFor(() => expect(remove).not.toBeDisabled())
    fireEvent.click(remove)
    expect(await screen.findByRole('alert')).toHaveTextContent('Changes could not be saved')
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(remove).not.toBeDisabled()
  })

  it('labels password fields and supports form submission without clearing a rejected password change', async () => {
    const change = vi
      .spyOn(window.api.auth, 'changePassword')
      .mockResolvedValue({ ok: false, reason: 'bad_password' })
    render(<ProfileTab />)
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    const current = screen.getByLabelText('Current password')
    const next = screen.getByLabelText('New password')
    const confirmation = screen.getByLabelText('Confirm new password')
    fireEvent.change(current, { target: { value: 'Old password' } })
    fireEvent.change(next, { target: { value: 'NewPassword123!' } })
    fireEvent.change(confirmation, { target: { value: 'NewPassword123!' } })
    fireEvent.submit(current.closest('form')!)
    await waitFor(() => expect(change).toHaveBeenCalledWith('Old password', 'NewPassword123!'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/current password/i)
    expect(current).toHaveValue('Old password')
    expect(next).toHaveValue('NewPassword123!')
  })

  it('shows a failed model preference without continuing to reload', async () => {
    const update = vi.fn().mockRejectedValue(new Error('Disk full'))
    const reload = vi.spyOn(window.api.llm, 'reload')
    const info = await window.api.llm.info()
    vi.spyOn(window.api.llm, 'info').mockResolvedValue({
      ...info,
      availableGpus: [{ name: 'Test GPU', kind: 'dedicated' }],
    })
    render(<LlmSection settings={DEFAULT_SETTINGS} update={update} />)
    const dedicated = screen.getByRole('radio', { name: /Dedicated/ })
    await waitFor(() => expect(dedicated).not.toBeDisabled())
    fireEvent.click(dedicated)
    expect(await screen.findByRole('alert')).toHaveTextContent('Changes could not be saved')
    expect(reload).not.toHaveBeenCalled()
  })

  it('shows rejected Ollama connection checks and permits retry', async () => {
    const probe = vi
      .spyOn(window.api.ollama, 'probe')
      .mockRejectedValueOnce(new Error('IPC failed'))
      .mockResolvedValue({ ok: true, version: 'test', models: [] })
    render(<OllamaSection settings={DEFAULT_SETTINGS} update={async () => {}} />)
    expect(await screen.findByText(/The connection could not be checked/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Connected · Ollama vtest/)).toBeVisible()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('ignores an older Ollama reply after the committed connection changes', async () => {
    let first!: (value: Awaited<ReturnType<typeof window.api.ollama.probe>>) => void
    const probe = vi
      .spyOn(window.api.ollama, 'probe')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve
          }),
      )
      .mockResolvedValue({ ok: true, version: 'new', models: [] })
    const view = render(<OllamaSection settings={DEFAULT_SETTINGS} update={async () => {}} />)
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    const next = structuredClone(DEFAULT_SETTINGS)
    next.advanced.ollama.baseUrl = 'http://localhost:11435'
    view.rerender(<OllamaSection settings={next} update={async () => {}} />)
    expect(await screen.findByText(/Connected · Ollama vnew/)).toBeVisible()
    await act(async () => first({ ok: true, version: 'old', models: [] }))
    expect(screen.queryByText(/Connected · Ollama vold/)).toBeNull()
    expect(screen.getByText(/Connected · Ollama vnew/)).toBeVisible()
  })
})
