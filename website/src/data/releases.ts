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
  version: '0.2.0',
  releasedAt: '2026-05-19',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-0.2.0-win-x64.zip',
      sizeBytes: 8747381780,
      sha256: '538855cb0cbf1dad1993a23751f97c8f52bb26da40393675f26b0da5a6c3d6b9',
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
      file: 'LokLM-0.2.0.AppImage',
      sizeBytes: 8752618053,
      sha256: '3a2749f73337c43c9c6d2008eca40393fb9d5bb874a74cb4e537b5cfd244ed25',
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
