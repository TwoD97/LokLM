import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const inPublic = (...segments: string[]) => resolve(root, 'public', ...segments)

describe('brand files', () => {
  // Everything Base.astro links to: favicon, OG images, mask/app icons.
  const brandFiles = [
    'favicon.svg',
    'brand/mark-color.svg',
    'brand/mark-mono.svg',
    'brand/app-paper.svg',
    'brand/og.png',
    'brand/og.svg',
  ]

  for (const rel of brandFiles) {
    it(`public/${rel} exists`, () => {
      expect(existsSync(inPublic(rel)), `missing public/${rel}`).toBe(true)
    })

    it(`public/${rel} has content`, () => {
      expect(statSync(inPublic(rel)).size, `public/${rel} is empty`).toBeGreaterThan(0)
    })
  }

  it('og.png exceeds 5 KB — anything smaller would be a stub, not a real graphic', () => {
    expect(statSync(inPublic('brand/og.png')).size).toBeGreaterThan(5 * 1024)
  })
})

describe('screenshot set', () => {
  // A 1x1 dummy webp weighs a handful of bytes; real captures are far above this.
  const STUB_CEILING_BYTES = 256

  const shots = [
    'hero-chat.webp',
    'step1-import.webp',
    'step2-ask.webp',
    'step3-verify.webp',
    'deepdive-citation.webp',
    'deepdive-vault.webp',
    'deepdive-offline.webp',
  ]

  for (const shot of shots) {
    it(`${shot} exists`, () => {
      expect(existsSync(inPublic('screenshots', shot))).toBe(true)
    })

    it(`${shot} is a real capture, not a placeholder`, () => {
      const size = statSync(inPublic('screenshots', shot)).size
      expect(
        size,
        `${shot} looks like a placeholder (${size} bytes ≤ ${STUB_CEILING_BYTES})`,
      ).toBeGreaterThan(STUB_CEILING_BYTES)
    })

    it(`${shot} ships an @1x companion`, () => {
      expect(existsSync(inPublic('screenshots', shot.replace(/\.webp$/, '@1x.webp')))).toBe(true)
    })
  }
})

describe('robots.txt source', () => {
  const robotsPath = inPublic('robots.txt')

  it('is present in public/', () => {
    expect(existsSync(robotsPath)).toBe(true)
  })

  it('references a sitemap', () => {
    expect(readFileSync(robotsPath, 'utf-8').toLowerCase()).toContain('sitemap')
  })
})
