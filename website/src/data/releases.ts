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
  version: '0.2.7',
  releasedAt: '2026-05-25',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-Setup-win-x64.exe',
      sizeBytes: 548428577,
      sha256: '12191a8f0699abb4c8f5efb3e4723f73d4e637f578a3ac3dfad6e690923db7b6',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 179803984,
      sha256: '8019dff0fc607cb231d096c3903bdba1646a2450b057a576af1bb201d238af1b',
      available: true,
    },
    {
      platform: 'linux',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 527362868,
      sha256: '3555dac1519891025ed41c36f2d3a9f0a47504daeb27c283d8eb7cbbdd036e96',
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
