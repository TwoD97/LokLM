import { describe, expect, it } from 'vitest'
import { avatarColorForHue, avatarColorForName } from './avatarColors'

/** Evaluate the emitted CSS channels independently of the palette's HSL math. */
function whiteContrast(css: string): number {
  const element = document.createElement('span')
  element.style.backgroundColor = css
  const channels = element.style.backgroundColor.match(/[\d.]+/g)!.map(Number)
  const linear = channels.map((value) => {
    const srgb = value / 255
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  })
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  return 1.05 / (luminance + 0.05)
}

describe('avatar initials contrast', () => {
  it('gives white text at least 4.5:1 contrast for every generated hue', () => {
    for (let hue = 0; hue < 360; hue++) {
      expect(whiteContrast(avatarColorForHue(hue)), `hue ${hue}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the existing blue while correcting the unreadable green and teal', () => {
    expect(avatarColorForHue(212)).toBe('rgb(52, 111, 178)')
    expect(avatarColorForHue(142)).not.toBe('rgb(52, 178, 98)')
    expect(avatarColorForHue(192)).not.toBe('rgb(52, 153, 178)')
  })

  it('keeps name-derived colors deterministic, trimmed and safe for empty names', () => {
    expect(avatarColorForName('  Synthetic  ')).toBe(avatarColorForName('Synthetic'))
    expect(avatarColorForName('')).toBe(avatarColorForName('?'))
    expect(whiteContrast(avatarColorForName('Accessibility fixture'))).toBeGreaterThanOrEqual(4.5)
  })
})
