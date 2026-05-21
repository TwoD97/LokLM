import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import type { AuthLoginStage } from '@shared/authTypes'

// integration: AuthService gegen ein echtes tmp userData-verzeichnis. ohne
// IPC und ohne BrowserWindow , aber mit echter argon2-derivation und echtem
// AES-GCM. langsam (~2-5s pro test wegen argon2) , also generous timeout.
//
// hinweis: argon2 ist ein native modul. postinstall baut es für electron.
// wenn vitest unter node läuft und das prebuilt nicht passt , muss vor
// diesem layer einmal `pnpm rebuild argon2` gegen node ausgeführt werden.

describe('AuthService (integration)', () => {
  let userDataDir: string
  let auth: AuthService

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-int-'))
    auth = new AuthService(userDataDir)
  })

  afterEach(async () => {
    // immer lock damit der inactivity-timer aus ist und PGlite zugemacht wird
    await auth.lock().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('register → status → lock → login round-trip', async () => {
    const reg = await auth.register({
      displayName: 'Test User',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    expect(reg.passphrase).toHaveLength(18)

    const statusUnlocked = await auth.status()
    expect(statusUnlocked.registered).toBe(true)
    expect(statusUnlocked.locked).toBe(false)
    expect(statusUnlocked.displayName).toBe('Test User')

    await auth.lock()
    const statusLocked = await auth.status()
    expect(statusLocked.locked).toBe(true)

    const login = await auth.login('Test12345!')
    expect(login.ok).toBe(true)
    expect(auth.isUnlocked()).toBe(true)
  }, 45_000)

  it('login mit falschem passwort schlägt fehl', async () => {
    await auth.register({
      displayName: 'Test User',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    await auth.lock()

    const result = await auth.login('wrong-password!')
    expect(result.ok).toBe(false)
    expect(auth.isUnlocked()).toBe(false)
  }, 45_000)

  it('login emits progress stages in order (deriving , decrypting , restoring , ready)', async () => {
    await auth.register({
      displayName: 'Test User',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    await auth.lock()

    const stages: AuthLoginStage[] = []
    const result = await auth.login('Test12345!', {
      onProgress: (s) => stages.push(s),
    })
    expect(result.ok).toBe(true)
    expect(stages).toEqual(['deriving', 'decrypting', 'restoring', 'ready'])
  }, 45_000)

  it('login progress reports only "deriving" before a bad password short-circuits', async () => {
    await auth.register({
      displayName: 'Test User',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    await auth.lock()

    const stages: AuthLoginStage[] = []
    const result = await auth.login('wrong-password!', {
      onProgress: (s) => stages.push(s),
    })
    expect(result.ok).toBe(false)
    // KDF ran (so "deriving" emitted) , unwrap failed , no decrypt/restore.
    expect(stages).toEqual(['deriving'])
  }, 45_000)

  // weitere flows als ausgangspunkt:
  // - reset mit der bei register erhaltenen passphrase
  // - 5x falsches passwort → lockout , status.lockedOutUntil gesetzt
  // - register zweimal hintereinander → throw "already registered"
  // - inactivity timer feuert lock callback (mit vi.useFakeTimers)
})
