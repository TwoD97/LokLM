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
import type { GpuDevice, GpuKind } from '../../../shared/documents'

export type Tier = 'lite' | 'standard' | 'pro'

export interface ModelManifestEntry {
  id: string
  sha256: string
}

export interface HardwareSnapshot {
  gpuName?: string | null
  gpuVramBytes?: number | null
  gpuArch?: string | null
  /** True when the chosen adapter is an integrated GPU. */
  gpuIntegrated?: boolean
  /** Shared system memory the iGPU may use (DXGI SharedSystemMemory). */
  gpuSharedBytes?: number | null
  /** Full GPU inventory the wizard's hardware probe enumerated at install time
   *  — each device classified dedicated/integrated. Drives the LLM device
   *  picker. Absent on markers written before this field existed (≤ v0.6.0). */
  gpus?: GpuDevice[]
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
 * The tier that should drive runtime behaviour (LLM profile recommendation,
 * reranker default, status-bar UI). Honours the `LOKLM_TIER` env override first
 * — set by the `pnpm dev --lite|--standard|--pro` launcher (scripts/dev.mjs) so
 * a dev run can emulate any install tier without a wizard marker. Falls back to
 * the install marker's tier, then null (plain dev/test, pre-v0.3.0 installs).
 *
 * Deliberately does NOT synthesize a full TierMarker: model availability and
 * the legacy-models sweep stay keyed on readTierMarker() so a dev run never
 * trips the "wizard-managed install" code paths (empty model list, sweeps).
 */
export function getEffectiveTier(): Tier | null {
  const env = process.env['LOKLM_TIER']
  if (isValidTier(env)) return env
  return readTierMarker()?.tier ?? null
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
 * Codebase indexing (ADR-0006: source-project workspaces embedded with the Qwen3
 * code model) is a Standard+Pro feature — the Lite tier is library-only (BGE-M3).
 * Keyed on the EFFECTIVE tier so the `pnpm dev --lite` override (LOKLM_TIER) is
 * honoured too: without this a dev `--lite` run still loaded the Qwen3 code
 * embedder and purged the BGE-M3 chunks on every launch. True on every no-tier
 * path (plain dev, test, pre-v0.3.0 installs) so development and legacy installs
 * keep full access; only an explicit `lite` tier disables it. Single source of
 * truth for the gate — used wherever a workspace would flip to 'codebase' or
 * load the code embedder.
 */
export function isCodebaseIndexingEnabled(): boolean {
  return getEffectiveTier() !== 'lite'
}

/**
 * The install-time GPU inventory the wizard enumerated, classified
 * dedicated/integrated. Returns [] on every no-marker path (dev, test,
 * pre-v0.6.1 installs) and when the marker predates the field — callers then
 * fall back to the runtime VRAM probe (single anonymous GPU) and offer only the
 * Auto device option. Each entry is validated; malformed rows are dropped.
 */
export function readGpuInventory(): GpuDevice[] {
  const marker = readTierMarker()
  const raw = marker?.hardware?.gpus
  if (!Array.isArray(raw)) return []
  const out: GpuDevice[] = []
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const d = g as Partial<GpuDevice>
    if (typeof d.name !== 'string') continue
    if (d.kind !== 'dedicated' && d.kind !== 'integrated') continue
    out.push({
      name: d.name,
      vendorId: typeof d.vendorId === 'number' ? d.vendorId : 0,
      deviceId: typeof d.deviceId === 'number' ? d.deviceId : 0,
      kind: d.kind as GpuKind,
      vramBytes: typeof d.vramBytes === 'number' ? d.vramBytes : 0,
      sharedBytes: typeof d.sharedBytes === 'number' ? d.sharedBytes : 0,
      vulkanIndex: typeof d.vulkanIndex === 'number' ? d.vulkanIndex : null,
    })
  }
  return out
}

/**
 * Test-only escape hatch. Production code should never call this — the
 * marker is install-time-immutable. Tests use it to swap in fixtures.
 */
export function __resetTierMarkerCacheForTest(): void {
  cachedMarker = undefined
  cachedApp = undefined
}
