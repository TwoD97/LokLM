import { describe, it, expect } from 'vitest'
import {
  currentRelease,
  downloadUrl,
  checksumUrl,
  formatSize,
  getAsset,
  type ReleaseAsset,
} from './releases'

// The module reads PUBLIC_INSTALLER_BASE_URL once at import time. Vitest runs
// without that variable, so every URL below is built on the fallback host.
const BASE = 'https://downloads.loklm.example'

const stubAsset = (patch: Partial<ReleaseAsset> = {}): ReleaseAsset => ({
  platform: 'windows',
  file: 'LokLM-Setup-test.exe',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  available: true,
  ...patch,
})

describe('formatSize', () => {
  it('shows an em-dash when the size is zero', () => {
    expect(formatSize(0)).toBe('—')
  })

  it('shows an em-dash when the size is negative', () => {
    expect(formatSize(-1)).toBe('—')
  })

  it.each([
    [512, '512 B', 'plain bytes carry no decimal'],
    [1023, '1023 B', 'stays in bytes right up to the 1 KB edge'],
    [1024, '1.0 KB', 'the exact 1 KB boundary gains one decimal'],
    [15 * 1024, '15 KB', 'KB values of 10 or more drop the decimal'],
    [1.5 * 1024 * 1024, '1.5 MB', 'MB values below 10 keep one decimal'],
    [393408476, '375 MB', 'MB values of 10 or more drop the decimal'],
    [2 * 1024 * 1024 * 1024, '2.0 GB', 'GB scale works'],
  ])('formats %d bytes as "%s" (%s)', (bytes, wanted) => {
    expect(formatSize(bytes)).toBe(wanted)
  })

  it('caps the unit ladder at TB', () => {
    expect(formatSize(5 * 1024 ** 5)).toMatch(/ TB$/)
  })
})

describe('downloadUrl', () => {
  it('composes base host, versioned folder and file name', () => {
    expect(downloadUrl(stubAsset({ file: 'foo.exe' }), '1.2.3')).toBe(`${BASE}/v1.2.3/foo.exe`)
  })

  it('falls back to the current release version when none is passed', () => {
    expect(downloadUrl(stubAsset({ file: 'bar.AppImage' }))).toBe(
      `${BASE}/v${currentRelease.version}/bar.AppImage`,
    )
  })

  it('leaves special characters in file names untouched — encoding is the caller\'s job', () => {
    expect(downloadUrl(stubAsset({ file: 'has space.exe' }), '0.1.0')).toBe(
      `${BASE}/v0.1.0/has space.exe`,
    )
  })
})

describe('checksumUrl', () => {
  it('is the download url plus a .sha256 suffix', () => {
    expect(checksumUrl(stubAsset({ file: 'foo.exe' }), '1.2.3')).toBe(
      `${BASE}/v1.2.3/foo.exe.sha256`,
    )
  })

  it('falls back to the current release version', () => {
    expect(checksumUrl(stubAsset({ file: 'bar.AppImage' }))).toBe(
      `${BASE}/v${currentRelease.version}/bar.AppImage.sha256`,
    )
  })
})

describe('getAsset', () => {
  it.each(['windows', 'linux'] as const)('looks up the %s asset', (platform) => {
    const asset = getAsset(platform)
    expect(asset).toBeDefined()
    expect(asset?.platform).toBe(platform)
  })

  it('still resolves the macos entry even though it may be a placeholder', () => {
    const asset = getAsset('macos')
    expect(asset).toBeDefined()
    expect(asset?.platform).toBe('macos')
  })
})

describe('currentRelease metadata', () => {
  it('carries a plain semver version', () => {
    expect(currentRelease.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('carries a parseable YYYY-MM-DD release date', () => {
    expect(currentRelease.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(currentRelease.releasedAt))).toBe(false)
  })

  it('ships assets for windows, macos and linux (linux may come in several variants)', () => {
    const platforms = new Set(currentRelease.assets.map((a) => a.platform))
    expect([...platforms].sort()).toEqual(['linux', 'macos', 'windows'])
  })

  it('distinguishes multiple linux builds via unique variant keys', () => {
    const linuxAssets = currentRelease.assets.filter((a) => a.platform === 'linux')
    if (linuxAssets.length > 1) {
      for (const a of linuxAssets) {
        expect(a.variant).toBeDefined()
      }
      const variants = linuxAssets.map((a) => a.variant)
      expect(new Set(variants).size).toBe(variants.length)
    }
  })
})

describe('per-asset integrity', () => {
  const HEX_SHA256 = /^[a-f0-9]{64}$/i

  const shipped = currentRelease.assets.filter((a) => a.available)
  const placeholders = currentRelease.assets.filter((a) => !a.available)

  for (const asset of shipped) {
    describe(`${asset.platform} build (${asset.file})`, () => {
      it('names its installer file', () => {
        expect(asset.file.length).toBeGreaterThan(0)
      })

      it('reports a positive byte size', () => {
        expect(asset.sizeBytes).toBeGreaterThan(0)
      })

      it('ships a full 64-hex-char sha256', () => {
        expect(asset.sha256).toMatch(HEX_SHA256)
      })

      it('uses the file extension expected for its platform', () => {
        if (asset.platform === 'windows') expect(asset.file).toMatch(/\.exe$/i)
        if (asset.platform === 'macos') expect(asset.file).toMatch(/\.dmg$/i)
        if (asset.platform === 'linux') expect(asset.file).toMatch(/\.(run|deb)$/)
      })

      it('downloads from the folder of the current version', () => {
        expect(downloadUrl(asset)).toContain(`/v${currentRelease.version}/`)
      })
    })
  }

  for (const asset of placeholders) {
    describe(`${asset.platform} placeholder`, () => {
      it('keeps the placeholder shape: empty hash, zero size', () => {
        expect(asset.sha256).toBe('')
        expect(asset.sizeBytes).toBe(0)
      })
    })
  }
})
