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

export type Tier = 'lite' | 'standard' | 'pro'

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
  /** Install-time opt-in for the external Ollama connector (wizard options
   *  page, default unchecked). Markers written before the field existed
   *  (≤ v0.4.0) parse to `true` — those installs predate the opt-in and may
   *  already rely on a configured Ollama backend; only an explicit `false`
   *  locks the connector. */
  ollamaConnector: boolean
}

const MARKER_FILENAME = 'loklm-tier.json'

type ElectronApp = { isPackaged: boolean; getPath?: (name: string) => string }

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
 * Directories the wizard may have written the marker to, in priority order.
 * Pure — takes its inputs explicitly so tests can exercise every platform
 * without an electron runtime.
 *
 * Windows + Linux: the marker is a direct sibling of the executable
 * ( <install-dir>/loklm-tier.json ). macOS: the .app bundle is signed and
 * read-only, so the wizard writes marker + models to
 * ~/Library/Application Support/LokLM instead — which is exactly Electron's
 * userData dir ( productName "LokLM" on both sides ). The exec-sibling dir
 * stays first so a hypothetical future bundle-relative layout would win.
 */
export function getMarkerCandidateDirs(
  platform: NodeJS.Platform,
  execPath: string,
  userDataDir: string | null,
): string[] {
  const dirs = [dirname(execPath)]
  if (platform === 'darwin' && userDataDir) dirs.push(userDataDir)
  return dirs
}

function getUserDataDirOrNull(app: ElectronApp): string | null {
  try {
    return app.getPath?.('userData') ?? null
  } catch {
    return null
  }
}

/**
 * Resolves the marker file the wizard wrote, trying each platform candidate
 * dir. Returns null in dev (`!app.isPackaged`), in vitest / tsx-script
 * contexts, and when no candidate contains the file.
 */
function findMarkerFile(): string | null {
  const app = getAppOrNull()
  if (!app || !app.isPackaged) return null
  const candidates = getMarkerCandidateDirs(
    process.platform,
    process.execPath,
    getUserDataDirOrNull(app),
  )
  for (const dir of candidates) {
    const path = join(dir, MARKER_FILENAME)
    if (existsSync(path)) return path
  }
  return null
}

let cachedMarker: TierMarker | null | undefined = undefined

/**
 * Reads + parses the tier marker. Cached after first call — the marker
 * doesn't change while the app is running, and a missed read shouldn't be
 * retried every time. Returns null when:
 *   - we're in dev or test (no install dir)
 *   - the marker file doesn't exist in any candidate dir (pre-v0.3.0
 *     install, the legacy path)
 *   - the file exists but parses as garbage (treated as missing; log + null)
 */
export function readTierMarker(): TierMarker | null {
  if (cachedMarker !== undefined) return cachedMarker

  const path = findMarkerFile()
  if (!path) {
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
      ollamaConnector: parsed.ollamaConnector !== false,
    }
    return cachedMarker
  } catch (err) {
    console.warn(`[TierMarker] failed to read ${path} :`, err)
    cachedMarker = null
    return null
  }
}

function isValidTier(v: unknown): v is Tier {
  return v === 'lite' || v === 'standard' || v === 'pro'
}

/**
 * Single source of truth for "did this install opt in to the external Ollama
 * connector". True when the marker says so, and true on the no-marker paths
 * (dev, test, pre-v0.3.0 installs) — the opt-in only exists for installs the
 * wizard wrote a marker for; everyone else keeps the historical behaviour.
 */
export function isOllamaConnectorEnabled(): boolean {
  const marker = readTierMarker()
  return marker === null || marker.ollamaConnector
}

/**
 * Test-only escape hatch. Production code should never call this — the
 * marker is install-time-immutable. Tests use it to swap in fixtures.
 */
export function __resetTierMarkerCacheForTest(): void {
  cachedMarker = undefined
  cachedApp = undefined
}
