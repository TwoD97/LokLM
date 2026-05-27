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
  version: '0.2.9',
  releasedAt: '2026-05-25',
  assets: [
    {
      platform: 'windows',
      file: 'LokLM-Setup-win-x64.exe',
      sizeBytes: 548423806,
      sha256: '0a438fa87e94b2f4687d2402a6f54a415e3e4ed8fa38f93b2e4cc3c16c14f1b0',
      available: true,
    },
    {
      platform: 'macos',
      file: 'LokLM-mac.dmg',
      sizeBytes: 179825803,
      sha256: 'efe728efcf0e81a03748eba7a44994f6fdcb1e34ee83c4a7ff3f1ba48d277db3',
      available: true,
    },
    {
      platform: 'linux',
      file: 'LokLM-Setup-linux-x64.run',
      sizeBytes: 527375970,
      sha256: '7d57f1bd90d854fe6e4b725f9e18605a488bc214381a756120bd54148aa2f58c',
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
