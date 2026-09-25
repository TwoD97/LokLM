import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWordlist, PASSPHRASE_WORDS } from '@shared/authHelpers'
import type { AuthStatus, LoginResult, ResetResult } from '@shared/authTypes'
import { authDict } from '../i18n/dict_auth'
import { LoginView } from './LoginView'
import { ResetView } from './ResetView'
import { PassphraseReveal } from './PassphraseReveal'

vi.mock('../i18n', () => ({
  useT:
    () =>
    (key: string, args: Record<string, string | number> = {}) => {
      const common: Record<string, string> = { 'common.next': 'Next', 'common.cancel': 'Cancel' }
      return (authDict.en[key] ?? common[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
        String(args[name] ?? name),
      )
    },
}))

const status: AuthStatus = {
  registered: true,
  locked: true,
  displayName: 'Alex',
  remainingRecoveryCodes: 1,
  recoveryLang: 'en',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Authentication transitions', () => {
  it('keeps recovery words visible after a copy failure, retries once, and clears the success timer on unmount', async () => {
    vi.useFakeTimers()
    let rejectCopy!: (reason: Error) => void
    const copy = vi
      .spyOn(window.api.auth, 'copySecret')
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectCopy = reject
          }),
      )
      .mockResolvedValue(undefined)
    const words = [...getWordlist('en').slice(0, PASSPHRASE_WORDS)]
    const acknowledge = vi.fn()
    const view = render(
      <PassphraseReveal words={words} title="Recovery words" onAcknowledge={acknowledge} />,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    const button = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(copy).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await act(async () => rejectCopy(new Error('Clipboard unavailable')))
    expect(screen.getByRole('alert')).toHaveTextContent('The words could not be copied')
    expect(screen.getAllByRole('listitem')).toHaveLength(PASSPHRASE_WORDS)
    expect(screen.getByText(words[0]!)).toBeVisible()
    expect(acknowledge).not.toHaveBeenCalled()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Try copying again' })),
    )
    expect(copy).toHaveBeenCalledTimes(2)
    expect(copy).toHaveBeenLastCalledWith(words.join(' '))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copied to clipboard' })).toBeEnabled()
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('prevents entering password reset while unlock is pending and restores controls after rejection', async () => {
    let finish!: (value: LoginResult) => void
    vi.spyOn(window.api.auth, 'login').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const forgot = vi.fn()
    const unlocked = vi.fn()
    render(<LoginView status={status} onUnlocked={unlocked} onForgotPassword={forgot} />)
    const password = screen.getByLabelText('Password')
    fireEvent.change(password, { target: { value: 'An incorrect password' } })
    fireEvent.submit(password.closest('form')!)
    const reset = screen.getByRole('button', { name: 'Forgot password?' })
    expect(password).toBeDisabled()
    expect(reset).toBeDisabled()
    fireEvent.click(reset)
    expect(forgot).not.toHaveBeenCalled()
    await act(async () => finish({ ok: false, reason: 'bad_password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Account or password incorrect')
    expect(password).toBeEnabled()
    expect(reset).toBeEnabled()
    expect(unlocked).not.toHaveBeenCalled()
  })

  it('prevents cancelling password reset while replacement recovery words are being generated', async () => {
    let finish!: (value: ResetResult) => void
    vi.spyOn(window.api.auth, 'reset').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const cancel = vi.fn()
    const reset = vi.fn()
    const words = [...getWordlist('en').slice(0, PASSPHRASE_WORDS)]
    render(<ResetView status={status} onReset={reset} onCancel={cancel} />)
    const recovery = screen.getByLabelText(/^Recovery words/)
    const password = screen.getByLabelText(/^New password/)
    const confirmation = screen.getByLabelText(/^Repeat new password/)
    fireEvent.change(recovery, { target: { value: words.join(' ') } })
    fireEvent.change(password, { target: { value: 'NewPassword123!' } })
    fireEvent.change(confirmation, { target: { value: 'NewPassword123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeDisabled()
    expect(recovery).toBeDisabled()
    expect(password).toBeDisabled()
    expect(confirmation).toBeDisabled()
    fireEvent.click(cancelButton)
    expect(cancel).not.toHaveBeenCalled()
    await act(async () => finish({ ok: true, passphrase: words }))
    expect(reset).toHaveBeenCalledWith(words)
    expect(cancel).not.toHaveBeenCalled()
  })
})
