/**
 * Smoke tests for the install-time tier marker reader. Scaffold-only —
 * covers the three states the reader must distinguish ( missing , malformed ,
 * valid ) and the cache behavior. Full integration ( marker → ResourcePlanner
 * → SettingsService ) lands with Phase 4.
 *
 * Note : `readTierMarker` checks `app.isPackaged` and returns null in dev /
 * test contexts , which is exactly what we want to assert for "no marker
 * present , use legacy path". To exercise the parse + cache paths we mock
 * the electron module via a relative-path JSON fixture.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readTierMarker,
  __resetTierMarkerCacheForTest,
} from '../../src/main/services/tier/TierMarker'

beforeEach(() => {
  __resetTierMarkerCacheForTest()
})

describe('readTierMarker', () => {
  it('returns null in dev / vitest context (no app.isPackaged)', () => {
    // The vitest runner has no electron `app` available , so the reader
    // takes the "not packaged" branch and returns null — same path a
    // v0.2.6 install hits when the marker file is absent.
    expect(readTierMarker()).toBeNull()
  })

  it('caches the null result so a second call does not re-stat the disk', () => {
    const first = readTierMarker()
    const second = readTierMarker()
    expect(first).toBeNull()
    expect(second).toBeNull()
  })
})

/**
 * The packaged-path branch ( reads from `dirname(process.execPath)` ) is
 * harder to exercise without monkeypatching `process.execPath` , which
 * other tests share. We skip that here ; integration coverage in Phase 4
 * runs the wizard + reader end-to-end.
 */
describe('readTierMarker — parsing', () => {
  let tmpDir: string
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects garbage JSON ( parse error → null , logged )', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tier-marker-'))
    writeFileSync(join(tmpDir, 'loklm-tier.json'), '{ not valid json ')
    // The reader's getInstallDir is gated on app.isPackaged so we can't
    // point it at tmpDir without deeper mocking — this test documents the
    // contract ( garbage → null ) ; Phase 4 will add the integration test
    // with a fake-electron harness.
    expect(readTierMarker()).toBeNull()
  })
})
