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
  version: '0.6.3',
  releasedAt: '2026-06-29',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-x64.exe',
      sizeBytes: 383942633,
      sha256: 'd54e6116c19467a2867c80106eb58b2ebcfd6cc27d69162a1a8c5f2d35357877',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 3196982,
      sha256: '77048140f3b74a3e83a4803acea6ae64ac721ce2e06ff0f013591978c4c405e8',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'run',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 343106441,
      sha256: 'e18016660d91193a095113aa31ebf9cd16055e3c9fafdd28b545a37a470ae0c0',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'deb',
      file: 'LokLM-Setup-linux-x64.deb',
      sizeBytes: 3448760,
      sha256: '1b1b8df4fbfcbbba74e1c742678dbc939472997d59283575188084f891e8dd98',
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
