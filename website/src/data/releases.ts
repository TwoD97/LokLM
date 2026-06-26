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
  version: '0.6.0',
  releasedAt: '2026-06-26',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-x64.exe',
      sizeBytes: 383928807,
      sha256: '4e0b078a831a7bbf21b4ad866cf9fec604f7fd4794cb337a92a7c0390bf394dc',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 3193240,
      sha256: '5c13cde8d1f29324333be4805abfdd2ae1439e3e4f27f88f7b62739ae03867f1',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'run',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 343112364,
      sha256: 'b9f001eeec22fc7722e76ad3e16e79733a2c7443fbd3d80870b903e7c95ee550',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'deb',
      file: 'LokLM-Setup-linux-x64.deb',
      sizeBytes: 3443404,
      sha256: 'e2fedbb2c6d2c4604fb65881552fcb8c8b7dadae2e4b04cd5acebb2a05b3d657',
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
