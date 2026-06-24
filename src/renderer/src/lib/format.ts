// Small human-readable formatters for the storage-footprint UI (and reusable
// elsewhere). Base-1000 to match disk-vendor sizing and the storage reports.

/** e.g. 4_380_000_000 → "4.4 GB", 214_000_000 → "214 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = bytes
  let i = 0
  while (size >= 1000 && i < units.length - 1) {
    size /= 1000
    i++
  }
  const decimals = i === 0 || size >= 100 ? 0 : 1
  return `${size.toFixed(decimals)} ${units[i]}`
}

/** e.g. 140_000 → "2.3 min", 7_000 → "7 s", 5_400_000 → "1.5 h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s'
  const s = ms / 1000
  if (s < 1) return `${Math.round(ms)} ms`
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
  const min = s / 60
  if (min < 60) return `${min < 10 ? min.toFixed(1) : Math.round(min)} min`
  const h = min / 60
  if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`
  return `${(h / 24).toFixed(1)} d`
}

/** Compact count: 50_000 → "50k", 5_000_000 → "5M", 142 → "142". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(n)))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
}
