import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

// crash-resilienz: die vault darf durch einen absturz nicht unbrauchbar werden.
// writeVaultNow hat dafür zwei schichten:
//   1. tmp + fsync + rename — die primary ist immer entweder die alte oder die
//      neue generation , nie ein gemisch. (fsync lässt sich hier nicht sinnvoll
//      testen , das prüft der happy-path in round-trip.test.ts implizit mit.)
//   2. loklm.vault.bak — byte-kopie des letzten erfolgreichen persists ,
//      lese-fallback wenn die primary fehlt oder korrupt ist.
// hier wird schicht 2 durchgespielt: primary löschen / strukturell zerstören /
// nur den body kippen — die daten müssen jedes mal noch erreichbar sein.

describe('vault crash-resilienz', () => {
  let userDataDir: string
  const vaultPath = (): string => join(userDataDir, 'loklm.vault')
  const bakPath = (): string => join(userDataDir, 'loklm.vault.bak')

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-vault-'))
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  async function registerAndLock(): Promise<void> {
    const auth = new AuthService(userDataDir)
    await auth.register({
      displayName: 'Dominik',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    await auth.lock()
  }

  it('persist schreibt primary + byte-identische .bak , kein .tmp bleibt liegen', async () => {
    await registerAndLock()

    const primary = await readFile(vaultPath())
    const backup = await readFile(bakPath())
    expect(primary.length).toBeGreaterThan(0)
    expect(primary.equals(backup)).toBe(true)

    await expect(stat(vaultPath() + '.tmp')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 45_000)

  it('primary gelöscht (quarantäne-fall) → status + login laufen über die .bak', async () => {
    await registerAndLock()
    await rm(vaultPath())

    // simulierter app-neustart: die .bak muss den user-zustand liefern
    const second = new AuthService(userDataDir)
    const status = await second.status()
    expect(status.registered).toBe(true)
    expect(status.displayName).toBe('Dominik')

    const login = await second.login('Test12345!')
    expect(login.ok).toBe(true)

    // lock persistiert → primary ist wieder da (self-heal)
    await second.lock()
    const healed = await stat(vaultPath())
    expect(healed.size).toBeGreaterThan(0)
  }, 45_000)

  it('primary-body korrupt (gcm-tag kippt) → login restauriert aus der .bak', async () => {
    await registerAndLock()

    // letztes byte liegt im ciphertext → struktur bleibt intakt , nur der
    // gcm-tag-check des bodys schlägt fehl. genau der torn-write-fall.
    const raw = await readFile(vaultPath())
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1)
    await writeFile(vaultPath(), raw)

    const second = new AuthService(userDataDir)
    const login = await second.login('Test12345!')
    expect(login.ok).toBe(true)
    await second.lock()

    // der persist beim lock hat die primary saniert: .bak weg , login muss
    // jetzt wieder allein über die primary laufen
    await rm(bakPath())
    const third = new AuthService(userDataDir)
    const healedLogin = await third.login('Test12345!')
    expect(healedLogin.ok).toBe(true)
    await third.lock()
  }, 60_000)

  it('beide dateien zerstört → sauberer fehler statt crash oder leerem neustart', async () => {
    await registerAndLock()

    // beide auf 16 bytes stutzen: magic + header-länge überleben , der rest
    // fehlt → "truncated" , kein json-parse-crash , kein stilles "no_user"
    const raw = await readFile(vaultPath())
    await writeFile(vaultPath(), raw.subarray(0, 16))
    await writeFile(bakPath(), raw.subarray(0, 16))

    const second = new AuthService(userDataDir)
    await expect(second.login('Test12345!')).rejects.toThrow(/truncated/)
  }, 45_000)

  it('passwort-wechsel erneuert die .bak , das alte passwort bleibt draussen', async () => {
    const auth = new AuthService(userDataDir)
    await auth.register({
      displayName: 'Dominik',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    const changed = await auth.changePassword('Test12345!', 'Neues12345!')
    expect(changed.ok).toBe(true)
    await auth.lock()

    // login über die .bak erzwingen: sie muss die NEUE generation tragen ,
    // sonst würde ein password-change durch den backup-fallback unterlaufen
    await rm(vaultPath())
    const second = new AuthService(userDataDir)
    const oldPw = await second.login('Test12345!')
    expect(oldPw.ok).toBe(false)
    const newPw = await second.login('Neues12345!')
    expect(newPw.ok).toBe(true)
    await second.lock()
  }, 60_000)
})
