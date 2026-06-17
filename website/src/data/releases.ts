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
  version: '0.4.7',
  releasedAt: '2026-06-16',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-x64.exe',
      sizeBytes: 324223495,
      sha256: 'e7a9916ec63d1a579111f270b44fc8193a7815f5727e94019c175ced712731cf',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 3192106,
      sha256: '990c505230db0dcb5704de304af79f5e510c666de99515eb88537aa09bb1d83c',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'run',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 285779915,
      sha256: 'f78877d3d7981841fe97912c3ff8de829ae2d4fe2cb3c11ff35e5d6aeb610065',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'deb',
      file: 'LokLM-Setup-linux-x64.deb',
      sizeBytes: 3441722,
      sha256: 'f0ceba61ccd4f75640d5a9805086dba9be04e588ffcd33140cfa7b8bac5103e7',
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
