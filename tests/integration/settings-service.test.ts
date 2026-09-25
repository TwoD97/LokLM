import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SettingsService, type SettingsKv } from '@main/services/settings/SettingsService'
import { DEFAULT_SETTINGS, DEFAULT_MODULES, SETTINGS_KEY, AVATAR_KEY } from '@shared/settings'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// ADR-0005: settings + avatar live in the encrypted vault body's kv store
// (AuthService getKv/setKv/deleteKv). This stub stands in for that in-memory
// map so the service can be tested without spinning up the full vault.
class MapKv implements SettingsKv {
  private readonly store = new Map<string, string>()
  getKv(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setKv(key: string, value: string): void {
    this.store.set(key, value)
  }
  deleteKv(key: string): void {
    this.store.delete(key)
  }
}

describe('SettingsService', () => {
  let db: MapKv
  let svc: SettingsService

  beforeEach(async () => {
    db = new MapKv()
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
    db.setKv(SETTINGS_KEY, JSON.stringify(legacy))
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

  it('migrates missing module, launch, calendar and reranker-policy fields without losing preferences', async () => {
    db.setKv(
      SETTINGS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        basic: { language: 'en', theme: 'dark' },
        advanced: { reranker: { enabled: false } },
      }),
    )
    await svc.hydrate()
    expect(svc.get().basic).toMatchObject({
      language: 'en',
      theme: 'dark',
      modules: DEFAULT_MODULES,
      startView: 'library',
      weekStartsOn: 1,
    })
    expect(svc.get().advanced.reranker).toMatchObject({ enabled: false, policy: 'auto' })
  })

  it('preserves partial module choices while filling in new modules and ignoring malformed visibility values', async () => {
    db.setKv(
      SETTINGS_KEY,
      JSON.stringify({
        basic: { modules: { calendar: false, quiz: false, notes: 'hidden' }, startView: 'notes' },
      }),
    )
    await svc.hydrate()
    expect(svc.get().basic.modules).toEqual({ ...DEFAULT_MODULES, calendar: false, quiz: false })
    expect(svc.get().basic.startView).toBe('notes')
  })

  it('falls back to Library when a stored launch view is hidden or no longer exists', async () => {
    for (const startView of ['notes', 'removed-feature']) {
      db.setKv(SETTINGS_KEY, JSON.stringify({ basic: { modules: { notes: false }, startView } }))
      await svc.hydrate()
      expect(svc.get().basic.startView).toBe('library')
    }
  })

  it('adjusts the launch view when hiding its module and preserves core Library/Chat access', async () => {
    await svc.update({ basic: { startView: 'notes' } })
    await svc.update({ basic: { modules: { notes: false } } })
    expect(svc.get().basic.startView).toBe('library')
    await svc.update({ basic: { startView: 'chat' } })
    expect(svc.get().basic.startView).toBe('chat')
    const reloaded = new SettingsService(db, async () => {})
    await reloaded.hydrate()
    expect(reloaded.get().basic).toMatchObject({ startView: 'chat', modules: { notes: false } })
  })

  it('normalizes calendar week and reranker policy while preserving valid explicit choices', async () => {
    await svc.update({ basic: { weekStartsOn: 0 }, advanced: { reranker: { policy: 'always' } } })
    expect(svc.get().basic.weekStartsOn).toBe(0)
    expect(svc.get().advanced.reranker.policy).toBe('always')
    await svc.update({
      basic: { weekStartsOn: 5 },
      advanced: { reranker: { policy: 'unknown' } },
    } as never)
    expect(svc.get().basic.weekStartsOn).toBe(1)
    expect(svc.get().advanced.reranker.policy).toBe('auto')
  })

  it('serializes concurrent preference patches against the last committed state', async () => {
    const gate = deferred()
    const started = deferred()
    const persist = vi.fn().mockImplementationOnce(async () => {
      started.resolve()
      await gate.promise
    })
    svc = new SettingsService(db, persist)
    const received: string[] = []
    svc.subscribe((settings) =>
      received.push(`${settings.basic.theme}/${settings.basic.modules.calendar}`),
    )
    const first = svc.update({ basic: { theme: 'dark' } })
    const second = svc.update({ basic: { modules: { calendar: false }, weekStartsOn: 0 } })
    await started.promise
    expect(svc.get().basic.theme).toBe('system')
    expect(received).toEqual([])
    expect(persist).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([first, second])
    expect(svc.get().basic).toMatchObject({
      theme: 'dark',
      modules: { calendar: false },
      weekStartsOn: 0,
    })
    expect(received).toEqual(['dark/true', 'dark/false'])
  })

  it('keeps old cache, storage and notifications unchanged after a failed preference write', async () => {
    await svc.update({ basic: { language: 'en' } })
    const stored = db.getKv(SETTINGS_KEY)
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValue(undefined)
    svc = new SettingsService(db, persist)
    await svc.hydrate()
    const listener = vi.fn()
    svc.subscribe(listener)
    await expect(svc.update({ basic: { theme: 'dark' } })).rejects.toThrow('Disk full')
    expect(svc.get().basic).toMatchObject({ language: 'en', theme: 'system' })
    expect(db.getKv(SETTINGS_KEY)).toBe(stored)
    expect(listener).not.toHaveBeenCalled()
    await svc.update({ basic: { weekStartsOn: 0 } })
    expect(svc.get().basic).toMatchObject({ language: 'en', theme: 'system', weekStartsOn: 0 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('uses atomic KV persistence without exposing a pending preference or invoking the fallback', async () => {
    const gate = deferred()
    const started = deferred()
    const durable = vi.fn(async (key: string, value: string | null) => {
      started.resolve()
      await gate.promise
      if (value === null) db.deleteKv(key)
      else db.setKv(key, value)
    })
    const atomic = Object.assign(db, { setKvDurably: durable })
    const fallback = vi.fn()
    svc = new SettingsService(atomic, fallback)
    const listener = vi.fn()
    svc.subscribe(listener)
    const saving = svc.update({ basic: { theme: 'dark' } })
    await started.promise
    expect(db.getKv(SETTINGS_KEY)).toBeNull()
    expect(svc.get().basic.theme).toBe('system')
    expect(listener).not.toHaveBeenCalled()
    gate.resolve()
    await saving
    expect(svc.get().basic.theme).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not publish settings after an atomic transaction fails', async () => {
    const atomic = Object.assign(db, {
      setKvDurably: vi.fn().mockRejectedValue(new Error('Transaction failed')),
    })
    svc = new SettingsService(atomic, vi.fn())
    const listener = vi.fn()
    svc.subscribe(listener)
    await expect(svc.update({ basic: { startView: 'calendar' } })).rejects.toThrow(
      'Transaction failed',
    )
    expect(svc.get().basic.startView).toBe('library')
    expect(listener).not.toHaveBeenCalled()
    expect(db.getKv(SETTINGS_KEY)).toBeNull()
  })

  it('makes avatar saves and removal durable, with no background debounce', async () => {
    const original = new Uint8Array([1, 2, 3])
    await svc.setAvatar(original)
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error('Avatar write failed'))
      .mockResolvedValue(undefined)
    svc = new SettingsService(db, persist)
    await expect(svc.setAvatar(null)).rejects.toThrow('Avatar write failed')
    expect(await svc.getAvatar()).toEqual(original)
    await svc.setAvatar(null)
    expect(await svc.getAvatar()).toBeNull()
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('uses the same atomic transaction path for avatar writes and deletes', async () => {
    const durable = vi.fn(async (key: string, value: string | null) => {
      if (value === null) db.deleteKv(key)
      else db.setKv(key, value)
    })
    const fallback = vi.fn()
    svc = new SettingsService(Object.assign(db, { setKvDurably: durable }), fallback)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    await svc.setAvatar(png)
    expect(await svc.getAvatar()).toEqual(png)
    await svc.setAvatar(null)
    expect(durable.mock.calls).toEqual([
      [AVATAR_KEY, Buffer.from(png).toString('base64')],
      [AVATAR_KEY, null],
    ])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rejects stale queued updates after invalidation without publishing an in-flight result', async () => {
    const gate = deferred()
    const started = deferred()
    const durable = vi.fn(async (key: string, value: string | null) => {
      started.resolve()
      await gate.promise
      if (value !== null) db.setKv(key, value)
    })
    svc = new SettingsService(Object.assign(db, { setKvDurably: durable }), vi.fn())
    const listener = vi.fn()
    svc.subscribe(listener)
    const first = svc.update({ basic: { theme: 'dark' } })
    const second = svc.update({ basic: { weekStartsOn: 0 } })
    const firstResult = expect(first).rejects.toThrow(/locked/)
    const secondResult = expect(second).rejects.toThrow(/locked/)
    await started.promise
    svc.invalidate()
    gate.resolve()
    await Promise.all([firstResult, secondResult, svc.drain()])
    expect(durable).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    expect(svc.get().basic.theme).toBe('system')
    await expect(svc.update({ basic: { language: 'en' } })).rejects.toThrow(/locked/)
  })

  it('rejects settings and avatar writes while the backing vault is locked', async () => {
    const durable = vi.fn()
    svc = new SettingsService(
      Object.assign(db, { setKvDurably: durable, isUnlocked: () => false }),
      vi.fn(),
    )
    await expect(svc.update({ basic: { theme: 'dark' } })).rejects.toThrow(/locked/)
    await expect(svc.setAvatar(new Uint8Array([1]))).rejects.toThrow(/locked/)
    expect(durable).not.toHaveBeenCalled()
  })
})
