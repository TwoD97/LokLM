import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const distExists = existsSync(resolve(root, 'dist'))

// dist/ is only present after `pnpm build`. these tests skip cleanly during
// regular `pnpm test` and run after `pnpm ci` (build + test).
describe.skipIf(!distExists)('dist build output', () => {
  const pages = [
    'dist/index.html',
    'dist/imprint/index.html',
    'dist/privacy/index.html',
    'dist/en/index.html',
    'dist/en/imprint/index.html',
    'dist/en/privacy/index.html',
  ]

  for (const p of pages) {
    it(`emits ${p}`, () => {
      expect(existsSync(resolve(root, p))).toBe(true)
    })
  }

  it('every page contains a <title> tag', () => {
    for (const p of pages) {
      const html = readFileSync(resolve(root, p), 'utf-8')
      expect(html, p).toMatch(/<title>.*<\/title>/i)
    }
  })

  it('every page declares a canonical link', () => {
    for (const p of pages) {
      const html = readFileSync(resolve(root, p), 'utf-8')
      expect(html, p).toMatch(/<link\s+rel="canonical"/i)
    }
  })

  it('every page embeds both JSON-LD schemas', () => {
    for (const p of pages) {
      const html = readFileSync(resolve(root, p), 'utf-8')
      expect(html, `${p} missing Organization`).toContain('"@type":"Organization"')
      expect(html, `${p} missing SoftwareApplication`).toContain('"@type":"SoftwareApplication"')
    }
  })

  it('de pages declare lang="de" and en pages declare lang="en"', () => {
    const de = readFileSync(resolve(root, 'dist/index.html'), 'utf-8')
    const en = readFileSync(resolve(root, 'dist/en/index.html'), 'utf-8')
    expect(de).toMatch(/<html\s+lang="de"/i)
    expect(en).toMatch(/<html\s+lang="en"/i)
  })
})

describe.skipIf(!distExists)('sitemap', () => {
  it('emits sitemap-index.xml pointing to a sub-sitemap', () => {
    const indexPath = resolve(root, 'dist/sitemap-index.xml')
    expect(existsSync(indexPath)).toBe(true)
    const body = readFileSync(indexPath, 'utf-8')
    expect(body).toContain('<sitemapindex')
    expect(body).toMatch(/<loc>https:\/\/loklm\.com\/sitemap-\d+\.xml<\/loc>/)
  })

  it('sub-sitemap lists all six pages with hreflang alternates', () => {
    const subPath = resolve(root, 'dist/sitemap-0.xml')
    expect(existsSync(subPath)).toBe(true)
    const body = readFileSync(subPath, 'utf-8')

    const locs = [
      'https://loklm.com',
      'https://loklm.com/imprint',
      'https://loklm.com/privacy',
      'https://loklm.com/en',
      'https://loklm.com/en/imprint',
      'https://loklm.com/en/privacy',
    ]
    for (const loc of locs) {
      expect(body, `missing <loc>${loc}</loc>`).toContain(`<loc>${loc}</loc>`)
    }

    expect(body).toContain('hreflang="de-DE"')
    expect(body).toContain('hreflang="en-US"')
  })
})
