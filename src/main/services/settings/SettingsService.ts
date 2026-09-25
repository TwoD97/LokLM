import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  AVATAR_KEY,
  type UserSettings,
  DEFAULT_MODULES,
  OPTIONAL_MODULES,
  isModuleVisible,
  type AppView,
} from '../../../shared/settings'

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export type SettingsListener = (settings: UserSettings) => void

/** App-global encrypted-vault store. AuthService provides isolated durable
 * transactions; simple test adapters may use the legacy snapshot callback. */
export interface SettingsKv {
  getKv(key: string): string | null
  setKv(key: string, value: string): void
  deleteKv(key: string): void
  setKvDurably?(key: string, value: string | null): Promise<void>
  isUnlocked?(): boolean
}

export class SettingsService {
  private cache: UserSettings
  private listeners: SettingsListener[] = []
  private updates: Promise<void> = Promise.resolve()
  private invalidated = false

  constructor(
    private readonly kv: SettingsKv,
    private readonly persistSnapshot: () => Promise<void>,
    // A caller can supply an installation-specific baseline. Persisted user
    // preferences still win, and fields from newer versions are back-filled.
    private readonly baseDefaults: UserSettings = DEFAULT_SETTINGS,
  ) {
    this.cache = normalizeSettings(baseDefaults)
  }

  async hydrate(): Promise<void> {
    const value = this.kv.getKv(SETTINGS_KEY)
    if (value == null) {
      this.cache = normalizeSettings(this.baseDefaults)
      return
    }
    try {
      const parsed = JSON.parse(value) as UserSettings
      this.cache = normalizeSettings(deepMerge(this.baseDefaults, parsed))
    } catch {
      this.cache = normalizeSettings(this.baseDefaults)
    }
  }

  get(): UserSettings {
    return this.cache
  }

  update(patch: DeepPartial<UserSettings>): Promise<void> {
    return this.enqueue(async () => {
      const next = normalizeSettings(deepMerge(this.cache, patch as Partial<UserSettings>))
      await this.persistValue(SETTINGS_KEY, JSON.stringify(next))
      this.assertActive()
      this.cache = next
      // Report changes only once they are durable; never log preference values.
      console.log(`[settings] updated: ${Object.keys(patch).join(', ')}`)
      for (const listener of this.listeners) {
        try {
          listener(this.cache)
        } catch {
          /* A UI subscriber cannot turn a successful save into a failure. */
        }
      }
    })
  }

  invalidate(): void {
    this.invalidated = true
    this.listeners = []
  }

  drain(): Promise<void> {
    return this.updates
  }

  subscribe(cb: SettingsListener): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  getAvatar(): Promise<Uint8Array | null> {
    return this.enqueue(async () => {
      const value = this.kv.getKv(AVATAR_KEY)
      if (!value) return null
      const buf = Buffer.from(value, 'base64')
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    })
  }

  setAvatar(bytes: Uint8Array | null): Promise<void> {
    // Capture caller-owned bytes before entering the async mutation queue.
    const value = bytes === null ? null : Buffer.from(bytes).toString('base64')
    return this.enqueue(async () => {
      await this.persistValue(AVATAR_KEY, value)
      this.assertActive()
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.updates.then(async () => {
      this.assertActive()
      return operation()
    })
    this.updates = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private assertActive(): void {
    if (this.invalidated || this.kv.isUnlocked?.() === false) {
      throw new Error('Settings session is locked. Unlock your account to change preferences.')
    }
  }

  private async persistValue(key: string, value: string | null): Promise<void> {
    if (this.kv.setKvDurably) {
      await this.kv.setKvDurably(key, value)
      return
    }
    const previous = this.kv.getKv(key)
    if (value === null) this.kv.deleteKv(key)
    else this.kv.setKv(key, value)
    try {
      await this.persistSnapshot()
    } catch (error) {
      // Compatibility for simple adapters. AuthService never stages values in
      // shared memory and therefore does not need a compensating rollback.
      if (!this.invalidated && this.kv.isUnlocked?.() !== false) {
        if (previous === null) this.kv.deleteKv(key)
        else this.kv.setKv(key, previous)
      }
      throw error
    }
  }
}

function normalizeSettings(settings: UserSettings): UserSettings {
  const modules = { ...DEFAULT_MODULES }
  for (const id of OPTIONAL_MODULES) {
    if (typeof settings.basic.modules?.[id] === 'boolean') modules[id] = settings.basic.modules[id]
  }
  const requested = settings.basic.startView
  const validViews: AppView[] = ['library', 'chat', ...OPTIONAL_MODULES]
  const startView =
    validViews.includes(requested) && isModuleVisible(modules, requested) ? requested : 'library'
  return {
    ...settings,
    basic: {
      ...settings.basic,
      modules,
      startView,
      weekStartsOn: settings.basic.weekStartsOn === 0 ? 0 : 1,
    },
    advanced: {
      ...settings.advanced,
      reranker: {
        ...settings.advanced.reranker,
        policy: settings.advanced.reranker.policy === 'always' ? 'always' : 'auto',
      },
    },
  }
}

function deepMerge<T extends object>(base: T, patch: Partial<T> | DeepPartial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue
    const baseV = (base as Record<string, unknown>)[k]
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      baseV !== null &&
      typeof baseV === 'object' &&
      !Array.isArray(baseV)
    ) {
      out[k] = deepMerge(baseV as object, v as object)
    } else {
      out[k] = v
    }
  }
  return out as T
}
