import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

// AP-9 Account §3.8 "neue Recovery-Codes anfordern". Integration: real argon2 +
// real AES-GCM vault. Regenerating wraps the live DEK under a fresh recovery
// passphrase and replaces the recovery entry, invalidating the old codes; the
// password wrap + body are untouched. Requires the current password. Slow
// (argon2) → generous timeouts.
describe('AuthService.regenerateRecovery (integration)', () => {
  let userDataDir: string
  let auth: AuthService
  const PW = 'OldPass123!'

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-rrc-'))
    auth = new AuthService(userDataDir)
  })

  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  })

  const register = (): ReturnType<AuthService['register']> =>
    auth.register({ displayName: 'Test User', password: PW, recoveryLang: 'de' })

  it('mints fresh recovery codes that reset the vault, while the old codes stop working', async () => {
    const reg = await register()
    const oldPassphrase = reg.passphrase.join(' ')

    const res = await auth.regenerateRecovery(PW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.passphrase).toHaveLength(18)
    const newPassphrase = res.passphrase.join(' ')
    expect(newPassphrase).not.toBe(oldPassphrase)

    await auth.lock()
    // Old code is now invalid...
    expect((await auth.reset({ passphrase: oldPassphrase, newPassword: 'ResetPass111!' })).ok).toBe(
      false,
    )
    // ...the new code resets the vault.
    expect((await auth.reset({ passphrase: newPassphrase, newPassword: 'ResetPass222!' })).ok).toBe(
      true,
    )
  }, 60_000)

  it('rejects a wrong current password and leaves the existing codes valid', async () => {
    const reg = await register()
    const oldPassphrase = reg.passphrase.join(' ')

    const res = await auth.regenerateRecovery('WrongCurrent1!')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_password')

    await auth.lock()
    expect((await auth.reset({ passphrase: oldPassphrase, newPassword: 'ResetPass333!' })).ok).toBe(
      true,
    )
  }, 60_000)

  it('leaves the old recovery codes intact when persisting the new ones fails', async () => {
    const reg = await register()
    const oldPassphrase = reg.passphrase.join(' ')

    const internal = auth as unknown as { writeVault: (h: unknown, b: unknown) => Promise<void> }
    const realWriteVault = internal.writeVault.bind(auth)
    internal.writeVault = () => Promise.reject(new Error('simulated disk failure'))

    let threw = false
    try {
      await auth.regenerateRecovery(PW)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    internal.writeVault = realWriteVault
    await auth.lock()
    // The original code must still reset the vault — no divergent in-memory state.
    expect((await auth.reset({ passphrase: oldPassphrase, newPassword: 'ResetPass444!' })).ok).toBe(
      true,
    )
  }, 60_000)
})
