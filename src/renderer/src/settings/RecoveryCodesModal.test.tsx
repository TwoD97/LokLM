import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecoveryCodesModal } from './RecoveryCodesModal'

afterEach(() => vi.restoreAllMocks())

// Drives the modal into the reveal step via the setupTests mock
// (regenerateRecovery resolves ok with 18 'test' words).
async function revealCodes(): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Aktuelles Passwort|Current password/i), {
    target: { value: 'Test12345!' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Generieren|Generate/i }))
  await waitFor(() => expect(screen.getAllByText('test').length).toBeGreaterThan(0))
}

describe('RecoveryCodesModal', () => {
  it('keeps the dialog open while replacement recovery codes are being generated', async () => {
    let finish!: (value: Awaited<ReturnType<typeof window.api.auth.regenerateRecovery>>) => void
    const generate = vi.spyOn(window.api.auth, 'regenerateRecovery').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const onClose = vi.fn()
    render(<RecoveryCodesModal onClose={onClose} />)
    const password = screen.getByLabelText('Current password')
    expect(password).toHaveFocus()
    fireEvent.change(password, { target: { value: 'Correct password' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    const backdrop = screen.getByRole('presentation')
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledTimes(1)
    finish({ ok: true, passphrase: Array(18).fill('test') })
    await waitFor(() => expect(screen.getAllByText('test')).toHaveLength(18))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('Escape on the password step closes only the recovery modal', () => {
    const onClose = vi.fn()
    render(<RecoveryCodesModal onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape during the reveal must NOT dismiss the one-time passphrase', async () => {
    const onClose = vi.fn()
    render(<RecoveryCodesModal onClose={onClose} />)
    await revealCodes()

    fireEvent.keyDown(window, { key: 'Escape' })

    // The old codes are already invalidated at this point — losing the new
    // ones to a stray Escape would lock the user out of recovery entirely.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getAllByText('test').length).toBeGreaterThan(0)
  })

  it('swallows Escape so an enclosing modal (Settings) cannot close mid-reveal', async () => {
    const outerEscape = vi.fn()
    // Simulates SettingsModal's window-level bubble listener that closes the
    // whole settings tree on Escape.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') outerEscape()
    })
    const onClose = vi.fn()
    render(<RecoveryCodesModal onClose={onClose} />)
    await revealCodes()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(outerEscape).not.toHaveBeenCalled()
  })
})
