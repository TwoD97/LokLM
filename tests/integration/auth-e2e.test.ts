import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'

// Pflichtenheft §8.2 — Auth End-to-End. Meilenstein M3 (29.05.2026) / Gate G2.
// Diese eine Test-Kette deckt die volle §8.2-Spec ab:
//
//   Registrierung → Login → Snapshot-Verschlüsselung → App-Restart
//   → Login mit Snapshot-Entschlüsselung → Recovery-Code-Reset
//   → Login mit neuem Passwort
//
// jeder "App-Restart" ist eine frische AuthService-Instanz gegen dasselbe
// userData-verzeichnis , so wie es nach einem electron-quit aussieht. dazwischen
// wird über den WorkspaceService realer DB-content geschrieben , gelesen und
// nach jedem round-trip verifiziert. wenn nur die vault-datei wieder aufgeht
// die seed-daten aber weg sind , schlägt der test fehl — genau das soll er.

describe('Auth E2E §8.2 (M3 / G2)', () => {
  let userDataDir: string

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-m3-'))
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('vollständige §8.2-Kette mit Datenpersistenz über Snapshot-Round-Trip', async () => {
    // ─── 1. Registrierung + seed-daten anlegen ────────────────────────────────
    const first = new AuthService(userDataDir)
    const { passphrase } = await first.register({
      displayName: 'Dominik',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    expect(passphrase).toHaveLength(18)

    const wsFirst = new WorkspaceService(first)
    const alpha = await wsFirst.create('Alpha')
    const bravo = await wsFirst.create('Bravo')
    const seededIds = [alpha.id, bravo.id].sort((a, b) => a - b)
    const seededNames = ['Alpha', 'Bravo']

    await first.lock()

    // vault-datei muss tatsächlich auf disk liegen — Snapshot-Verschlüsselung
    const vaultStats = await stat(join(userDataDir, 'loklm.vault'))
    expect(vaultStats.size).toBeGreaterThan(0)

    // ─── 2. App-Restart , Login mit altem Passwort , Daten müssen überleben ──
    const second = new AuthService(userDataDir)
    const statusBefore = await second.status()
    expect(statusBefore.registered).toBe(true)
    expect(statusBefore.locked).toBe(true)
    expect(statusBefore.displayName).toBe('Dominik')

    const loginOld = await second.login('Test12345!')
    expect(loginOld.ok).toBe(true)

    const wsSecond = new WorkspaceService(second)
    const afterRestart = await wsSecond.list()
    expect(afterRestart.map((w) => w.id).sort((a, b) => a - b)).toEqual(seededIds)
    expect(afterRestart.map((w) => w.name).sort()).toEqual(seededNames)

    await second.lock()

    // ─── 3. Recovery-Code-Reset , neues Passwort vergeben ────────────────────
    const third = new AuthService(userDataDir)
    const reset = await third.reset({
      passphrase: passphrase.join(' '),
      newPassword: 'Neues12345!',
    })
    expect(reset.ok).toBe(true)
    if (!reset.ok) throw new Error('reset failed') // type-narrowing für TS

    // nach reset ist die session offen → daten müssen schon hier wieder da sein
    const wsThird = new WorkspaceService(third)
    const afterReset = await wsThird.list()
    expect(afterReset.map((w) => w.id).sort((a, b) => a - b)).toEqual(seededIds)

    await third.lock()

    // ─── 4. App-Restart , Login mit NEUEM Passwort , Daten weiterhin da ─────
    const fourth = new AuthService(userDataDir)

    // altes passwort darf nicht mehr funktionieren
    const oldStillWorks = await fourth.login('Test12345!')
    expect(oldStillWorks.ok).toBe(false)

    const loginNew = await fourth.login('Neues12345!')
    expect(loginNew.ok).toBe(true)

    const wsFourth = new WorkspaceService(fourth)
    const finalList = await wsFourth.list()
    expect(finalList.map((w) => w.id).sort((a, b) => a - b)).toEqual(seededIds)
    expect(finalList.map((w) => w.name).sort()).toEqual(seededNames)

    await fourth.lock()
  }, 120_000)
})
