import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from '@main/db/database'
import { SettingsService } from '@main/services/settings/SettingsService'
import { DEFAULT_SETTINGS } from '@shared/settings'

describe('SettingsService', () => {
  let db: Database
  let svc: SettingsService

  beforeEach(async () => {
    db = await Database.create(undefined)
    svc = new SettingsService(db, async () => {
      /* persist noop */
    })
    await svc.hydrate()
  })

  it('returns DEFAULT_SETTINGS on a fresh DB', () => {
    expect(svc.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips an update through the DB', async () => {
    await svc.update({ basic: { language: 'en' } })
    // re-hydrate from a fresh service to prove persistence:
    const svc2 = new SettingsService(db, async () => {})
    await svc2.hydrate()
    expect(svc2.get().basic.language).toBe('en')
  })

  it('merges deep partials without dropping siblings', async () => {
    await svc.update({ advanced: { ollama: { baseUrl: 'http://10.0.0.5:11434' } } })
    const s = svc.get()
    expect(s.advanced.ollama.baseUrl).toBe('http://10.0.0.5:11434')
    expect(s.advanced.ollama.requestTimeoutMs).toBe(60000)
    expect(s.advanced.llm.source).toBe('bundled')
  })

  it('notifies subscribers on update', async () => {
    let received: unknown = null
    svc.subscribe((s) => {
      received = s.basic.language
    })
    await svc.update({ basic: { language: 'en' } })
    expect(received).toBe('en')
  })

  it('stores and reads the avatar blob', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    await svc.setAvatar(png)
    expect(await svc.getAvatar()).toEqual(png)
  })

  it('clears the avatar', async () => {
    await svc.setAvatar(new Uint8Array([1, 2, 3]))
    await svc.setAvatar(null)
    expect(await svc.getAvatar()).toBeNull()
  })
})
