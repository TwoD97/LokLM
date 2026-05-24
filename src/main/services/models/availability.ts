/**
 * Map the static manifest against what's actually on disk. Used by:
 *   - The renderer's first-launch gate (show the download UI if any required
 *     model is missing).
 *   - The Settings panel (per-model status badges).
 *   - The downloader, to decide whether to skip / resume / start fresh.
 */

import { statSync } from 'node:fs'
import { MODEL_MANIFEST, type ModelManifestEntry } from './manifest'
import { getDownloadTargetDir, resolveModelFile } from './paths'
import type { ModelAvailability, ModelsStatus } from '../../../shared/documents'
import { readTierMarker } from '../tier/TierMarker'

/** ±2% size tolerance — covers Content-Length jitter (CDN re-quantisations,
 *  unicode BOM stripping, etc.) without letting a 50%-downloaded `.partial`
 *  file pass. */
const SIZE_TOLERANCE = 0.02

function isWithinTolerance(actual: number, expected: number): boolean {
  if (expected <= 0) return actual > 0
  const ratio = Math.abs(actual - expected) / expected
  return ratio <= SIZE_TOLERANCE
}

export function checkOne(entry: ModelManifestEntry): ModelAvailability {
  const resolvedPath = resolveModelFile(entry.filename)
  let actualSizeBytes: number | null = null
  let present = false
  if (resolvedPath) {
    try {
      const stats = statSync(resolvedPath)
      actualSizeBytes = stats.size
      present = isWithinTolerance(stats.size, entry.sizeBytes)
    } catch {
      // File vanished between resolve and stat — treat as missing.
      actualSizeBytes = null
      present = false
    }
  }
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    kind: entry.kind,
    filename: entry.filename,
    sizeBytes: entry.sizeBytes,
    required: entry.required,
    resolvedPath,
    present,
    actualSizeBytes,
  }
}

export function checkAll(): ModelsStatus {
  // v0.3.0+ : if the wizard wrote a tier marker , the bundle for that tier
  // was downloaded + verified ( SHA256 / size ) during install. Skip the
  // in-app first-launch downloader entirely ; the legacy MODEL_MANIFEST
  // doesn't describe what the wizard installed ( it pre-dates tiers ) , so
  // we can't usefully iterate it for these installs. Settings panel will
  // get a tier-aware view in v0.3.1 ; for now an empty models list is the
  // honest answer ( "we don't manage models here anymore" ).
  if (readTierMarker() !== null) {
    return {
      downloadDir: getDownloadTargetDir(),
      models: [],
      allRequiredReady: true,
    }
  }

  // v0.2.6 fallback : no marker , so this is either dev mode or a legacy
  // install that hasn't been re-installed through the wizard. Keep the
  // first-launch download flow alive for those users.
  const models = MODEL_MANIFEST.map(checkOne)
  const allRequiredReady = models.filter((m) => m.required).every((m) => m.present)
  return {
    downloadDir: getDownloadTargetDir(),
    models,
    allRequiredReady,
  }
}
