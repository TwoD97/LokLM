// version manifest , bei release bumpen + asset auf mirror schieben , dann
// push auf main. action baut und deployt.

export type Platform = 'windows' | 'macos' | 'linux'

// Per platform optional , disambiguates assets when more than one is
// shipped ( Linux : 'run' for the makeself self-extractor , 'deb' for
// Debian/Ubuntu ). Used as a stable key for i18n button labels.
export type AssetVariant = 'run' | 'deb'

export interface ReleaseAsset {
  platform: Platform
  variant?: AssetVariant
  file: string
  sizeBytes: number
  sha256: string
  available: boolean
}

export interface Release {
  version: string
  releasedAt: string
  assets: ReleaseAsset[]
}

export const currentRelease: Release = {
  version: '0.6.1',
  releasedAt: '2026-06-28',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-x64.exe',
      sizeBytes: 383941429,
      sha256: 'd4c25251d32376daae3b415e420f1f63a8e8370f9792450156ce24b49f1a1549',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 3196806,
      sha256: '706c93a43122990c14f275dbd6a20bace1acb05a6560231ca9db61f3a86d4d10',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'run',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 343113456,
      sha256: '99ad724c50fb132f6839dc67568af99372a6f5868fcdc3e29d1528d6081b284b',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'deb',
      file: 'LokLM-Setup-linux-x64.deb',
      sizeBytes: 3448634,
      sha256: '41f18bcf730c477d16f5bc4714719d9b2d03153dae2583f4b54083b6239e3a38',
      available: true,
    },
  ],
}

const BASE_URL =
  (import.meta.env.PUBLIC_INSTALLER_BASE_URL?.replace(/\/$/, '') ?? '') ||
  'https://downloads.loklm.example'

export function downloadUrl(asset: ReleaseAsset, version = currentRelease.version): string {
  return `${BASE_URL}/v${version}/${asset.file}`
}

export function checksumUrl(asset: ReleaseAsset, version = currentRelease.version): string {
  return `${BASE_URL}/v${version}/${asset.file}.sha256`
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function getAsset(platform: Platform): ReleaseAsset | undefined {
  return currentRelease.assets.find((a) => a.platform === platform)
}

// Plural sibling of getAsset() — used when a platform has multiple
// variants ( Linux : .run + .deb ). Preserves manifest order so callers
// can render buttons in a stable sequence.
export function getAssets(platform: Platform): ReleaseAsset[] {
  return currentRelease.assets.filter((a) => a.platform === platform)
}
