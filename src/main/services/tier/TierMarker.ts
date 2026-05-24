/**
 * Reader for the install-time tier marker (`loklm-tier.json`) written by the
 * Tauri wizard during install. Shape and rationale are documented in
 * `docs/superpowers/plans/2026-05-23-light-normal-pro-tiers.md`.
 *
 * Returning `null` is the explicit v0.2.6-fallback path: pre-v0.3.0 installs
 * never produced this file, so callers (ResourcePlanner, SettingsService,
 * etc. — wired in Phase 4) must treat `null` as "no tier info, use the
 * legacy settings-based path".
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

export type Tier = 'light' | 'normal' | 'pro'

export interface ModelManifestEntry {
  id: string
  sha256: string
}

export interface HardwareSnapshot {
  gpuName?: string | null
  gpuVramBytes?: number | null
  gpuArch?: string | null
  cpuThreads?: number
  cpuBrand?: string
  ramBytes?: number
  recommendedTier?: Tier
}

export interface TierMarker {
  tier: Tier
  installedAt: string
  installerVersion: string
  hardware?: HardwareSnapshot | null
  models: ModelManifestEntry[]
}

const MARKER_FILENAME = 'loklm-tier.json'

type ElectronApp = { isPackaged: boolean }

let cachedApp: ElectronApp | null | undefined = undefined
function getAppOrNull(): ElectronApp | null {
  if (cachedApp !== undefined) return cachedApp
  try {
    const localRequire = createRequire(import.meta.url)
    const mod = localRequire('electron') as { app?: ElectronApp }
    cachedApp = mod && typeof mod === 'object' && mod.app ? mod.app : null
  } catch {
    cachedApp = null
  }
  return cachedApp
}

/**
 * Resolves the install directory the wizard wrote the marker to. Returns
 * null in dev (`!app.isPackaged`) and in vitest / tsx-script contexts. The
 * packaged-Windows + packaged-Linux layouts both put the marker as a direct
 * sibling of the running executable.
 */
function getInstallDir(): string | null {
  const app = getAppOrNull()
  if (!app || !app.isPackaged) return null
  return dirname(process.execPath)
}

let cachedMarker: TierMarker | null | undefined = undefined

/**
 * Reads + parses the tier marker. Cached after first call — the marker
 * doesn't change while the app is running, and a missed read shouldn't be
 * retried every time. Returns null when:
 *   - we're in dev or test (no install dir)
 *   - the marker file doesn't exist (pre-v0.3.0 install, the legacy path)
 *   - the file exists but parses as garbage (treated as missing; log + null)
 */
export function readTierMarker(): TierMarker | null {
  if (cachedMarker !== undefined) return cachedMarker

  const installDir = getInstallDir()
  if (!installDir) {
    cachedMarker = null
    return null
  }

  const path = join(installDir, MARKER_FILENAME)
  if (!existsSync(path)) {
    cachedMarker = null
    return null
  }

  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<TierMarker>
    if (!isValidTier(parsed.tier)) {
      console.warn(`[TierMarker] invalid tier in ${path} : ${String(parsed.tier)}`)
      cachedMarker = null
      return null
    }
    cachedMarker = {
      tier: parsed.tier,
      installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : '',
      installerVersion: typeof parsed.installerVersion === 'string' ? parsed.installerVersion : '',
      hardware: parsed.hardware ?? null,
      models: Array.isArray(parsed.models) ? parsed.models : [],
    }
    return cachedMarker
  } catch (err) {
    console.warn(`[TierMarker] failed to read ${path} :`, err)
    cachedMarker = null
    return null
  }
}

function isValidTier(v: unknown): v is Tier {
  return v === 'light' || v === 'normal' || v === 'pro'
}

/**
 * Test-only escape hatch. Production code should never call this — the
 * marker is install-time-immutable. Tests use it to swap in fixtures.
 */
export function __resetTierMarkerCacheForTest(): void {
  cachedMarker = undefined
  cachedApp = undefined
}
