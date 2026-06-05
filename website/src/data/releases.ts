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
  version: '0.3.1',
  releasedAt: '2026-06-05',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-x64.exe',
      sizeBytes: 267232473,
      sha256: '62cf25e67e57d3d3e37beef219ec2c28e3ed5b4fe06c2fda9676b6c02bc94dcb',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 3186918,
      sha256: '235fe6d3eba59d2460c2f8d561eba98601049ed5fc3d3d680ed459c5cf50026e',
      available: true,
    },
    {
      platform: 'linux',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 244670555,
      sha256: 'eedf1e056d45ccbfa1e89e27f690e9d0c2c19e2bb46cf0235fa0a600e5560d13',
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
