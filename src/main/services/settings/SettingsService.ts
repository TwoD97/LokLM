import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  AVATAR_KEY,
  type UserSettings,
} from '../../../shared/settings'

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export type SettingsListener = (settings: UserSettings) => void

/** App-global key/value store backing settings + avatar (ADR-0005). Formerly the
 *  PGlite `settings` table; now an in-memory map inside the encrypted vault body,
 *  provided by AuthService. Reads/writes are synchronous; durability is the next
 *  vault persist (scheduled via persistSnapshot). */
export interface SettingsKv {
  getKv(key: string): string | null
  setKv(key: string, value: string): void
  deleteKv(key: string): void
}

export class SettingsService {
  private cache: UserSettings
  private listeners: SettingsListener[] = []
  private persistTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly kv: SettingsKv,
    private readonly persistSnapshot: () => Promise<void>,
    // Tier-adjusted baseline. Defaults to the universal DEFAULT_SETTINGS ; the
    // 'lite' install tier passes a variant with reranker.enabled flipped off so
    // a fresh lite install (or a pre-feature row missing the key) defaults the
    // reranker off. Persisted user choices still win via deepMerge below.
    private readonly baseDefaults: UserSettings = DEFAULT_SETTINGS,
  ) {
    this.cache = baseDefaults
  }

  async hydrate(): Promise<void> {
    const value = this.kv.getKv(SETTINGS_KEY)
    if (value == null) {
      this.cache = this.baseDefaults
      return
    }
    try {
      const parsed = JSON.parse(value) as UserSettings
      this.cache = deepMerge(this.baseDefaults, parsed)
    } catch {
      this.cache = this.baseDefaults
    }
  }

  get(): UserSettings {
    return this.cache
  }

  async update(patch: DeepPartial<UserSettings>): Promise<void> {
    this.cache = deepMerge(this.cache, patch as Partial<UserSettings>)
    this.kv.setKv(SETTINGS_KEY, JSON.stringify(this.cache))
    for (const l of this.listeners) {
      try {
        l(this.cache)
      } catch {
        /* ignore */
      }
    }
    this.schedulePersist()
  }

  subscribe(cb: SettingsListener): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  async getAvatar(): Promise<Uint8Array | null> {
    const value = this.kv.getKv(AVATAR_KEY)
    if (!value) return null
    const buf = Buffer.from(value, 'base64')
    // Return a plain Uint8Array view of the bytes so callers / tests don't
    // observe Node's Buffer prototype (Buffer is a Uint8Array subclass , but
    // structural-equality checks like vitest's toEqual treat them as different
    // shapes).
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  async setAvatar(bytes: Uint8Array | null): Promise<void> {
    if (bytes === null) {
      this.kv.deleteKv(AVATAR_KEY)
    } else {
      this.kv.setKv(AVATAR_KEY, Buffer.from(bytes).toString('base64'))
    }
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistSnapshot().catch(() => {
        /* swallow */
      })
    }, 1500)
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
