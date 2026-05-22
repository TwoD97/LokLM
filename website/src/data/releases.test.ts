import { describe, it, expect } from 'vitest'
import {
  currentRelease,
  downloadUrl,
  checksumUrl,
  formatSize,
  getAsset,
  type ReleaseAsset,
} from './releases'

// BASE_URL is captured at module load. In the vitest env PUBLIC_INSTALLER_BASE_URL
// is unset, so the fallback applies.
const FALLBACK_BASE = 'https://downloads.loklm.example'

function makeAsset(over: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return {
    platform: 'windows',
    file: 'LokLM-Setup-test.exe',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    available: true,
    ...over,
  }
}

describe('downloadUrl', () => {
  it('joins base url, version prefix, and file name', () => {
    const asset = makeAsset({ file: 'foo.exe' })
    expect(downloadUrl(asset, '1.2.3')).toBe(`${FALLBACK_BASE}/v1.2.3/foo.exe`)
  })

  it('defaults to currentRelease.version when version arg omitted', () => {
    const asset = makeAsset({ file: 'bar.AppImage' })
    expect(downloadUrl(asset)).toBe(`${FALLBACK_BASE}/v${currentRelease.version}/bar.AppImage`)
  })

  it('does not encode special characters in file names (caller responsibility)', () => {
    const asset = makeAsset({ file: 'has space.exe' })
    expect(downloadUrl(asset, '0.1.0')).toBe(`${FALLBACK_BASE}/v0.1.0/has space.exe`)
  })
})

describe('checksumUrl', () => {
  it('appends .sha256 suffix to the file', () => {
    const asset = makeAsset({ file: 'foo.exe' })
    expect(checksumUrl(asset, '1.2.3')).toBe(`${FALLBACK_BASE}/v1.2.3/foo.exe.sha256`)
  })

  it('defaults to currentRelease.version', () => {
    const asset = makeAsset({ file: 'bar.AppImage' })
    expect(checksumUrl(asset)).toBe(
      `${FALLBACK_BASE}/v${currentRelease.version}/bar.AppImage.sha256`,
    )
  })
})

describe('formatSize', () => {
  it('returns em-dash for zero', () => {
    expect(formatSize(0)).toBe('—')
  })

  it('returns em-dash for negative input', () => {
    expect(formatSize(-1)).toBe('—')
  })

  it('renders bytes without decimal', () => {
    expect(formatSize(512)).toBe('512 B')
  })

  it('renders 1023 B (boundary just below 1 KB)', () => {
    expect(formatSize(1023)).toBe('1023 B')
  })

  it('renders exactly 1024 as 1.0 KB', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
  })

  it('renders large KB without decimal once >= 10', () => {
    expect(formatSize(15 * 1024)).toBe('15 KB')
  })

  it('renders MB with one decimal when < 10', () => {
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })

  it('renders MB without decimal when >= 10', () => {
    expect(formatSize(393408476)).toBe('375 MB')
  })

  it('renders GB scale', () => {
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })

  it('does not exceed TB unit', () => {
    const huge = 5 * 1024 ** 5
    expect(formatSize(huge)).toMatch(/ TB$/)
  })
})

describe('getAsset', () => {
  it('returns the windows asset when present', () => {
    const asset = getAsset('windows')
    expect(asset).toBeDefined()
    expect(asset?.platform).toBe('windows')
  })

  it('returns the linux asset when present', () => {
    const asset = getAsset('linux')
    expect(asset).toBeDefined()
    expect(asset?.platform).toBe('linux')
  })

  it('returns the macos asset placeholder (available may be false)', () => {
    const asset = getAsset('macos')
    expect(asset).toBeDefined()
    expect(asset?.platform).toBe('macos')
  })
})

describe('currentRelease shape', () => {
  it('has a semver-style version string', () => {
    expect(currentRelease.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('has an ISO date for releasedAt', () => {
    expect(currentRelease.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(currentRelease.releasedAt))).toBe(false)
  })

  it('covers all three platforms exactly once', () => {
    const platforms = currentRelease.assets.map((a) => a.platform).sort()
    expect(platforms).toEqual(['linux', 'macos', 'windows'])
  })
})

describe('release asset integrity', () => {
  const SHA256_RE = /^[a-f0-9]{64}$/i

  for (const asset of currentRelease.assets) {
    describe(`asset: ${asset.platform}`, () => {
      if (asset.available) {
        it('has a non-empty file name', () => {
          expect(asset.file.length).toBeGreaterThan(0)
        })

        it('has positive sizeBytes', () => {
          expect(asset.sizeBytes).toBeGreaterThan(0)
        })

        it('has a 64-char hex sha256', () => {
          expect(asset.sha256).toMatch(SHA256_RE)
        })

        it('file extension matches platform', () => {
          if (asset.platform === 'windows') expect(asset.file).toMatch(/\.exe$/i)
          if (asset.platform === 'macos') expect(asset.file).toMatch(/\.dmg$/i)
          if (asset.platform === 'linux') expect(asset.file).toMatch(/\.AppImage$/)
        })

        it('file name contains the release version', () => {
          expect(asset.file).toContain(currentRelease.version)
        })
      } else {
        it('not-yet-available asset has empty hash and zero size (placeholder shape)', () => {
          expect(asset.sha256).toBe('')
          expect(asset.sizeBytes).toBe(0)
        })
      }
    })
  }
})
