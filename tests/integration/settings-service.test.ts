import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from '@main/db/database'
import { SettingsService } from '@main/services/settings/SettingsService'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '@shared/settings'
import { sql } from 'drizzle-orm'

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

  it('defaults theme to system on a fresh DB', () => {
    expect(svc.get().basic.theme).toBe('system')
  })

  it('defaults the AP-9 partner slots', () => {
    const s = svc.get()
    expect(s.retrieval).toEqual({ chunkSize: 2000, chunkOverlap: 200, topK: 10 })
    expect(s.runtime.conversationSwitch).toBe('keep')
    expect(s.security.autoLockMinutes).toBe(15)
  })

  it('back-fills new fields when hydrating pre-AP-9 settings', async () => {
    // An install whose persisted JSON predates theme/retrieval/runtime/security.
    const legacy = {
      schemaVersion: 1,
      basic: {
        language: 'en',
        answerLanguage: 'auto',
        llmProfile: 'auto',
        showPipelineSteps: false,
      },
      advanced: DEFAULT_SETTINGS.advanced,
    }
    await db.db.execute(sql`
      INSERT INTO settings (key, value) VALUES (${SETTINGS_KEY}, ${JSON.stringify(legacy)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `)
    const svc2 = new SettingsService(db, async () => {})
    await svc2.hydrate()
    expect(svc2.get().basic.theme).toBe('system')
    expect(svc2.get().retrieval.topK).toBe(10)
    expect(svc2.get().security.autoLockMinutes).toBe(15)
    // a persisted choice still wins over the back-filled default:
    expect(svc2.get().basic.language).toBe('en')
  })

  it('round-trips a theme change', async () => {
    await svc.update({ basic: { theme: 'dark' } })
    const svc2 = new SettingsService(db, async () => {})
    await svc2.hydrate()
    expect(svc2.get().basic.theme).toBe('dark')
  })

  it('round-trips a user-set retrieval value through the DB', async () => {
    await svc.update({ retrieval: { chunkSize: 4000 } })
    const svc2 = new SettingsService(db, async () => {})
    await svc2.hydrate()
    expect(svc2.get().retrieval.chunkSize).toBe(4000)
    // sibling retrieval fields preserved by deep-merge
    expect(svc2.get().retrieval.topK).toBe(10)
  })

  it('round-trips user-set runtime + security values', async () => {
    await svc.update({ runtime: { conversationSwitch: 'unload' } })
    await svc.update({ security: { autoLockMinutes: 0 } })
    const svc2 = new SettingsService(db, async () => {})
    await svc2.hydrate()
    expect(svc2.get().runtime.conversationSwitch).toBe('unload')
    expect(svc2.get().security.autoLockMinutes).toBe(0)
  })
})
