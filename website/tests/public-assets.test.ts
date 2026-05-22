import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')

describe('brand assets', () => {
  // Files referenced from Base.astro (OG, icons, mask icon, app icon).
  const required = [
    'public/favicon.svg',
    'public/brand/mark-color.svg',
    'public/brand/mark-mono.svg',
    'public/brand/app-paper.svg',
    'public/brand/og.png',
    'public/brand/og.svg',
  ]

  for (const rel of required) {
    it(`${rel} exists`, () => {
      expect(existsSync(resolve(root, rel)), `missing ${rel}`).toBe(true)
    })

    it(`${rel} is non-empty`, () => {
      const size = statSync(resolve(root, rel)).size
      expect(size, `${rel} is empty`).toBeGreaterThan(0)
    })
  }

  it('og.png is at least 5 KB (real graphic, not a stub)', () => {
    const size = statSync(resolve(root, 'public/brand/og.png')).size
    expect(size).toBeGreaterThan(5 * 1024)
  })
})

describe('screenshots', () => {
  const PLACEHOLDER_MAX_BYTES = 256
  const required = [
    'hero-chat.webp',
    'step1-import.webp',
    'step2-ask.webp',
    'step3-verify.webp',
    'deepdive-citation.webp',
    'deepdive-vault.webp',
    'deepdive-offline.webp',
  ]

  for (const name of required) {
    it(`${name} exists`, () => {
      expect(existsSync(resolve(root, 'public/screenshots', name))).toBe(true)
    })

    it(`${name} is no longer a 1x1 placeholder`, () => {
      const size = statSync(resolve(root, 'public/screenshots', name)).size
      expect(
        size,
        `${name} looks like a placeholder (${size} bytes ≤ ${PLACEHOLDER_MAX_BYTES})`,
      ).toBeGreaterThan(PLACEHOLDER_MAX_BYTES)
    })

    it(`${name} has an @1x variant`, () => {
      const at1x = name.replace(/\.webp$/, '@1x.webp')
      expect(existsSync(resolve(root, 'public/screenshots', at1x))).toBe(true)
    })
  }
})

describe('robots.txt', () => {
  const robotsPath = resolve(root, 'public/robots.txt')

  it('exists', () => {
    expect(existsSync(robotsPath)).toBe(true)
  })

  it('mentions the sitemap', () => {
    const body = readFileSync(robotsPath, 'utf-8')
    expect(body.toLowerCase()).toContain('sitemap')
  })
})
