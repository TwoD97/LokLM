import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

// AP-9 Account §3.8 "Passwort ändern". Integration: real argon2 KEK derivation
// + real AES-GCM vault, no IPC / BrowserWindow. Changing the password re-wraps
// the same DEK under a new password-KEK; the body and recovery entries are
// untouched. Slow (argon2) → generous timeouts.
describe('AuthService.changePassword (integration)', () => {
  let userDataDir: string
  let auth: AuthService
  const OLD = 'OldPass123!'
  const NEW = 'NewPass456!'

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-cpw-'))
    auth = new AuthService(userDataDir)
  })

  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  })

  const register = (): ReturnType<AuthService['register']> =>
    auth.register({ displayName: 'Test User', password: OLD, recoveryLang: 'de' })

  it('re-keys the vault: the new password unlocks, the old one no longer does', async () => {
    await register()
    const res = await auth.changePassword(OLD, NEW)
    expect(res.ok).toBe(true)

    await auth.lock()
    expect((await auth.login(OLD)).ok).toBe(false)
    expect((await auth.login(NEW)).ok).toBe(true)
  }, 60_000)

  it('rejects a wrong current password and leaves the vault unchanged', async () => {
    await register()
    const res = await auth.changePassword('WrongCurrent1!', NEW)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_password')

    await auth.lock()
    // the attempted new password must not work; the original still does.
    expect((await auth.login(NEW)).ok).toBe(false)
    expect((await auth.login(OLD)).ok).toBe(true)
  }, 60_000)

  it('rejects a weak new password and leaves the vault unchanged', async () => {
    await register()
    const res = await auth.changePassword(OLD, 'short')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('weak_password')

    await auth.lock()
    expect((await auth.login(OLD)).ok).toBe(true)
  }, 60_000)

  it('leaves the session on the OLD password when persisting the re-key fails', async () => {
    await register()

    // Force the vault write during the change to fail, simulating disk-full /
    // EIO mid-rekey.
    const internal = auth as unknown as { writeVault: (h: unknown, b: unknown) => Promise<void> }
    const realWriteVault = internal.writeVault.bind(auth)
    internal.writeVault = () => Promise.reject(new Error('simulated disk failure'))

    let threw = false
    try {
      await auth.changePassword(OLD, NEW)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    // Restore the real write and trigger a normal persist (lock). A divergent
    // in-memory header would silently flush the NEW password to disk here —
    // committing a change the caller saw fail. It must not.
    internal.writeVault = realWriteVault
    await auth.lock()

    expect((await auth.login(NEW)).ok).toBe(false)
    expect((await auth.login(OLD)).ok).toBe(true)
  }, 60_000)

  it('keeps the recovery passphrase valid after a password change', async () => {
    const reg = await register()
    expect((await auth.changePassword(OLD, NEW)).ok).toBe(true)
    await auth.lock()

    // The recovery code minted at registration still resets the vault, proving
    // the recovery entry was left intact (it wraps the same, unchanged DEK).
    const reset = await auth.reset({
      passphrase: reg.passphrase.join(' '),
      newPassword: 'ResetPass789!',
    })
    expect(reset.ok).toBe(true)
  }, 60_000)
})
