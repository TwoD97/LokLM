import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { PASSPHRASE_WORDS } from '../../../shared/authHelpers'
import { AuthService } from './AuthService'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}))

describe('AuthService integration', () => {
  it('registers, locks, persists and unlocks a vault', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'loklm-auth-'))
    const password = 'CorrectHorse42!'

    try {
      const auth = new AuthService(userDataDir)

      expect(await auth.status()).toMatchObject({
        registered: false,
        locked: true,
      })

      // register
      const { passphrase } = await auth.register({
        displayName: 'Test User',
        password,
        recoveryLang: 'de',
      })

      expect(passphrase).toHaveLength(PASSPHRASE_WORDS)
      expect(await auth.status()).toMatchObject({
        registered: true,
        locked: false,
        displayName: 'Test User',
        remainingRecoveryCodes: 1,
        recoveryLang: 'de',
      })

      // persist/lock
      await auth.lock()
      expect(await auth.status()).toMatchObject({
        registered: true,
        locked: true,
      })

      // reload/login
      const reloadedAuth = new AuthService(userDataDir)
      await expect(reloadedAuth.login(password)).resolves.toEqual({ ok: true })
      expect(await reloadedAuth.status()).toMatchObject({
        registered: true,
        locked: false,
        displayName: 'Test User',
      })

      await reloadedAuth.lock()
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
