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
  version: '0.1.0',
  releasedAt: '2026-05-17',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-Setup-0.1.0.exe',
      sizeBytes: 107607277,
      sha256: 'fd0727f3d2a885c47e5a38382c8ef4e1d9e7c0beeea407499264e6dd445f8226',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-0.1.0.dmg',
      sizeBytes: 0,
      sha256: '',
      available: false,
    },
    {
      platform: 'linux',
      file: 'LokLM-0.1.0.AppImage',
      sizeBytes: 0,
      sha256: '',
      available: false,
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
