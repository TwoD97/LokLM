// version manifest , bei release bumpen + asset auf mirror schieben , dann
// push auf main. action baut und deployt.

export type Platform = 'windows' | 'macos' | 'linux'

export interface ReleaseAsset {
  platform: Platform
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
  version: '0.2.3',
  releasedAt: '2026-05-19',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-Setup-0.2.3-win-x64.exe',
      sizeBytes: 393408476,
      sha256: '2ee2c23736765ceefc5b6be3ecc94a33b395acbe40f4a81057eecf2af023ce0a',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-0.1.2.dmg',
      sizeBytes: 0,
      sha256: '',
      available: false,
    },
    {
      platform: 'linux',
      file: 'LokLM-0.2.3.AppImage',
      sizeBytes: 524976865,
      sha256: '379c7f6516eb9efead1516f35d5bac807d3cf0f51378c24f6a7f554d8aac237b',
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
