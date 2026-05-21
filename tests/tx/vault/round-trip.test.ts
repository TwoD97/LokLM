import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

// vault-round-trip: register → lock schreibt loklm.vault auf disk →
// neuer AuthService liest sie ein → login entschlüsselt wieder.
// keine asserts gegen DB-inhalt weil das schema noch leer ist. sobald reale
// tabellen landen , hier vor dem lock einen seed-insert , nach dem login einen
// select machen und gleichheit prüfen.

describe('vault round-trip', () => {
  let userDataDir: string

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-vault-'))
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('register → lock → neuer AuthService → login', async () => {
    const first = new AuthService(userDataDir)
    await first.register({
      displayName: 'Dominik',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    await first.lock()

    // vault-datei existiert wirklich auf disk
    const stats = await stat(join(userDataDir, 'loklm.vault'))
    expect(stats.size).toBeGreaterThan(0)

    // simulierter app-neustart
    const second = new AuthService(userDataDir)
    const beforeLogin = await second.status()
    expect(beforeLogin.registered).toBe(true)
    expect(beforeLogin.locked).toBe(true)
    expect(beforeLogin.displayName).toBe('Dominik')

    const login = await second.login('Test12345!')
    expect(login.ok).toBe(true)

    const afterLogin = await second.status()
    expect(afterLogin.locked).toBe(false)

    await second.lock()
  }, 45_000)

  it('reset mit passphrase überlebt round-trip', async () => {
    const first = new AuthService(userDataDir)
    const { passphrase } = await first.register({
      displayName: 'Dominik',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    await first.lock()

    // app-neustart , reset mit der passphrase und neuem passwort
    const second = new AuthService(userDataDir)
    const reset = await second.reset({
      passphrase: passphrase.join(' '),
      newPassword: 'Neues12345!',
    })
    expect(reset.ok).toBe(true)
    if (!reset.ok) return // typescript

    await second.lock()

    // app-neustart , login mit dem neuen passwort
    const third = new AuthService(userDataDir)
    const login = await third.login('Neues12345!')
    expect(login.ok).toBe(true)
    await third.lock()
  }, 45_000)
})
