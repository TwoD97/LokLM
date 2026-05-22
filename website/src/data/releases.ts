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
  version: '0.2.6',
  releasedAt: '2026-05-22',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-Setup-win-x64.exe',
      sizeBytes: 544057608,
      sha256: 'efec08f6ab49f8baf9578aa052e80b5cd5541ce7272abb575734754949947bb3',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 177331180,
      sha256: 'eacb1334ce4fe9a9b3ae95e73bafaa67fb523e7da8a8a0406cceed9ba8869cbd',
      available: true,
    },
    {
      platform: 'linux',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 523019150,
      sha256: '005e8bfc7d6714405af9339026b2c7a8e167154886b8dabc60d575bc3f9cc167',
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
