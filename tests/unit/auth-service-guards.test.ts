import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AuthService } from '@main/services/auth/AuthService'

// AP-T.1 (Pflichtenheft §8.1) — characterization unit tests for AuthService's
// locked-state guards and register input validation. Every path here
// short-circuits BEFORE any Argon2 KDF or pglite/vault I/O, so they unit-test
// cheaply and cover the branch arms the (success-path) integration tests skip.
// A non-existent userData dir makes every readVault() return null (ENOENT) →
// the service reports "not registered / locked". No vault file is ever written.

const freshService = (): AuthService =>
  new AuthService(join(tmpdir(), `loklm-apt1-${randomBytes(6).toString('hex')}`))

// a password that satisfies the policy (≥10 chars, ≥3 char-classes) so register
// gets PAST validatePassword to the field it's meant to reject.
const VALID_PW = 'Sup3r-Secret-9!'

describe('AuthService — locked / unregistered guards', () => {
  it('reports unregistered + locked when no vault exists on disk', async () => {
    const status = await freshService().status()
    expect(status).toMatchObject({
      registered: false,
      locked: true,
      displayName: null,
      remainingRecoveryCodes: 0,
      recoveryLang: null,
    })
  })

  it('isUnlocked() is false before any login', () => {
    expect(freshService().isUnlocked()).toBe(false)
  })

  it('requireDatabase() throws a LockedError while locked', () => {
    expect(() => freshService().requireDatabase()).toThrowError(/locked/i)
  })

  it('verifyPassword() short-circuits to locked_session while locked', async () => {
    expect(await freshService().verifyPassword('whatever')).toEqual({
      ok: false,
      reason: 'locked_session',
    })
  })

  it('changePassword() short-circuits to locked_session while locked', async () => {
    expect(await freshService().changePassword('old', VALID_PW)).toEqual({
      ok: false,
      reason: 'locked_session',
    })
  })

  it('setDisplayName() is a no-op (no throw) with a valid name while locked', async () => {
    await expect(freshService().setDisplayName('Valid Name')).resolves.toBeUndefined()
  })

  it('setDisplayName() still rejects an out-of-range name even while locked', async () => {
    await expect(freshService().setDisplayName('   ')).rejects.toThrow(/1–40/)
  })

  it('lock() / logout() are no-ops with no live session', async () => {
    await expect(freshService().logout()).resolves.toBeUndefined()
  })

  it('persistSnapshotIfUnlocked() is a no-op while locked', async () => {
    await expect(freshService().persistSnapshotIfUnlocked()).resolves.toBeUndefined()
  })
})

describe('AuthService — register input validation (pre-KDF)', () => {
  it('rejects an unsupported recoveryLang before doing any work', async () => {
    await expect(
      freshService().register({
        displayName: 'Valid Name',
        password: 'whatever',
        recoveryLang: 'fr' as never,
      }),
    ).rejects.toThrow(/recoveryLang/)
  })

  it('rejects a too-short display name', async () => {
    await expect(
      freshService().register({ displayName: 'ab', password: VALID_PW, recoveryLang: 'de' }),
    ).rejects.toThrow(/Display name/)
  })

  it('rejects a weak password before touching the KDF', async () => {
    await expect(
      freshService().register({ displayName: 'Valid Name', password: 'short', recoveryLang: 'de' }),
    ).rejects.toThrow(/at least 10/)
  })
})

describe('AuthService — setInactivityMs clamp', () => {
  it('accepts both a below-floor and an above-floor window (Math.max branch)', () => {
    const svc = freshService()
    expect(() => {
      svc.setInactivityMs(1_000) // below 60s floor → clamped
      svc.setInactivityMs(20 * 60_000) // above floor → kept
    }).not.toThrow()
  })
})
