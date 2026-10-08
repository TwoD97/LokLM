import { afterEach, describe, expect, it, vi } from 'vitest'
import bundles from '../../installer-wizard/model-manifest.json'
import {
  getActiveModelManifest,
  getDownloadManifestEntry,
} from '../../src/main/services/models/installedManifest'
import { MODEL_MANIFEST } from '../../src/main/services/models/manifest'
import * as tier from '../../src/main/services/tier/TierMarker'
import * as paths from '../../src/main/services/models/paths'

afterEach(() => vi.restoreAllMocks())

function installedTier(value: tier.Tier): void {
  vi.spyOn(tier, 'readTierMarker').mockReturnValue({
    tier: value,
    installedAt: '',
    installerVersion: '0.7.0',
    models: [],
    ollamaConnector: false,
  })
  vi.spyOn(paths, 'resolveModelFile').mockReturnValue(null)
}

describe('installed model download catalog', () => {
  it.each(['lite', 'standard', 'pro'] as const)(
    'resolves every required %s bundle model to the same repair entry',
    (value) => {
      installedTier(value)
      const models = getActiveModelManifest()
      expect(models).toHaveLength(bundles.tiers[value].models.length)
      for (const expected of bundles.tiers[value].models) {
        const actual = models.find((entry) => entry.id === expected.id)
        expect(actual).toMatchObject({
          id: expected.id,
          filename: expected.filename,
          kind: expected.role,
          sizeBytes: expected.sizeBytes,
          url: expected.url,
          required: true,
        })
        expect(actual?.sha256).toBe(expected.sha256 ?? undefined)
        expect(getDownloadManifestEntry(expected.id)).toEqual(actual)
      }
      expect(models.some((entry) => entry.kind === 'llm')).toBe(true)
      expect(models.some((entry) => entry.kind === 'reranker' && entry.required)).toBe(true)
    },
  )

  it('keeps the development/legacy catalog unchanged without a marker', () => {
    vi.spyOn(tier, 'readTierMarker').mockReturnValue(null)
    expect(getActiveModelManifest()).toBe(MODEL_MANIFEST)
    expect(getDownloadManifestEntry('arbitrary-path-or-url')).toBeUndefined()
  })

  it('retains 2B-only Lite compatibility and a pinned repair for a missing recorded 2B', () => {
    installedTier('lite')
    const marker = tier.readTierMarker()!
    marker.models = [{ id: 'Qwen_Qwen3.5-2B-Q4_K_M', sha256: '' }]
    const entry = getActiveModelManifest().find((model) => model.kind === 'llm')!
    expect(entry.filename).toBe('Qwen3.5-2B-Q4_K_M.gguf')
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(getDownloadManifestEntry(entry.id)).toEqual(entry)
    marker.models = []
    vi.mocked(paths.resolveModelFile).mockImplementation((filename) =>
      filename === entry.filename ? '/existing/2b.gguf' : null,
    )
    expect(getActiveModelManifest().find((model) => model.kind === 'llm')).toEqual(entry)
  })

  it('does not change Lite preference when its current 4B file exists', () => {
    installedTier('lite')
    vi.mocked(paths.resolveModelFile).mockImplementation((filename) => `/existing/${filename}`)
    expect(getActiveModelManifest().find((entry) => entry.kind === 'llm')?.filename).toBe(
      'Qwen3.5-4B-Q4_K_M.gguf',
    )
  })

  it('ignores malformed model records in an otherwise readable marker', () => {
    installedTier('lite')
    tier.readTierMarker()!.models = [null] as unknown as tier.TierMarker['models']
    expect(getActiveModelManifest().find((entry) => entry.kind === 'llm')?.filename).toBe(
      'Qwen3.5-4B-Q4_K_M.gguf',
    )
  })
})
