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
  version: '0.6.4',
  releasedAt: '2026-06-30',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-x64.exe',
      sizeBytes: 383977983,
      sha256: '70d0803c8f241d6215fcf9fe50d09aa65fe9b584d92ab35cf0f7b56d136bded7',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 3196953,
      sha256: '951f8668035264f221842595827eb5d46b43dcf8aea018b2e731a786adc01dea',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'run',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 343134172,
      sha256: 'e6afc9e7662a69059d6283878ba8bf92c50eee5259a9445e0bb78dc4b9610d09',
      available: true,
    },
    {
      platform: 'linux',
      variant: 'deb',
      file: 'LokLM-Setup-linux-x64.deb',
      sizeBytes: 3448756,
      sha256: '47cffe95679ca257202d0bbd6da7922f83f289b006c348c64120eead1bc202ee',
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
