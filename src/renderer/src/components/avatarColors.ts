type Rgb = [number, number, number]

function hslRgb(hue: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * 0.55
  const cross = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const base = lightness - chroma / 2
  const channels =
    hue < 60
      ? [chroma, cross, 0]
      : hue < 120
        ? [cross, chroma, 0]
        : hue < 180
          ? [0, chroma, cross]
          : hue < 240
            ? [0, cross, chroma]
            : hue < 300
              ? [cross, 0, chroma]
              : [chroma, 0, cross]
  return channels.map((channel) => Math.round((channel + base) * 255)) as Rgb
}

function luminance(channels: Rgb): number {
  return channels.reduce((sum, channel, index) => {
    const srgb = channel / 255
    const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]!
  }, 0)
}

/** Keep the existing hue/saturation; darken only colors whose white initials
 * would fall below AA contrast, including small 14px preset previews. */
export function avatarColorForHue(hue: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360
  for (let lightness = 45; lightness >= 0; lightness--) {
    const rgb = hslRgb(normalizedHue, lightness / 100)
    if (1.05 / (luminance(rgb) + 0.05) >= 4.5) return `rgb(${rgb.join(', ')})`
  }
  return '#000'
}

export function avatarColorForName(name: string): string {
  const value = name.trim() || '?'
  let hash = 0
  for (let index = 0; index < value.length; index++)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  return avatarColorForHue(hash % 360)
}
