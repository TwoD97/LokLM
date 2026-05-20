import { sql } from 'drizzle-orm'
import type { Database } from '../../db/database'
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  AVATAR_KEY,
  type UserSettings,
} from '../../../shared/settings'

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export type SettingsListener = (settings: UserSettings) => void

export class SettingsService {
  private cache: UserSettings = DEFAULT_SETTINGS
  private listeners: SettingsListener[] = []
  private persistTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: Database,
    private readonly persistSnapshot: () => Promise<void>,
  ) {}

  async hydrate(): Promise<void> {
    const r = await this.db.db.execute(sql`
      SELECT value FROM settings WHERE key = ${SETTINGS_KEY} LIMIT 1
    `)
    const row = (r.rows as Array<{ value: string }>)[0]
    if (!row) {
      this.cache = DEFAULT_SETTINGS
      return
    }
    try {
      const parsed = JSON.parse(row.value) as UserSettings
      this.cache = deepMerge(DEFAULT_SETTINGS, parsed)
    } catch {
      this.cache = DEFAULT_SETTINGS
    }
  }

  get(): UserSettings {
    return this.cache
  }

  async update(patch: DeepPartial<UserSettings>): Promise<void> {
    this.cache = deepMerge(this.cache, patch as Partial<UserSettings>)
    await this.writeKv(SETTINGS_KEY, JSON.stringify(this.cache))
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
    const r = await this.db.db.execute(sql`
      SELECT value FROM settings WHERE key = ${AVATAR_KEY} LIMIT 1
    `)
    const row = (r.rows as Array<{ value: string }>)[0]
    if (!row || !row.value) return null
    const buf = Buffer.from(row.value, 'base64')
    // Return a plain Uint8Array view of the bytes so callers / tests don't
    // observe Node's Buffer prototype (Buffer is a Uint8Array subclass , but
    // structural-equality checks like vitest's toEqual treat them as different
    // shapes).
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  async setAvatar(bytes: Uint8Array | null): Promise<void> {
    if (bytes === null) {
      await this.db.db.execute(sql`DELETE FROM settings WHERE key = ${AVATAR_KEY}`)
    } else {
      const b64 = Buffer.from(bytes).toString('base64')
      await this.writeKv(AVATAR_KEY, b64)
    }
    this.schedulePersist()
  }

  private async writeKv(key: string, value: string): Promise<void> {
    await this.db.db.execute(sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `)
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
