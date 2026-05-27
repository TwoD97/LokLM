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

describe.skipIf(!distExists)('SEO cluster routes', () => {
  const routes = [
    'lokale-ki',
    'architektur',
    'benchmarks',
    'en/local-ai',
    'en/architecture',
    'en/benchmarks',
    'einsatz/anwalt',
    'einsatz/forschung',
    'einsatz/beratung',
    'einsatz/entwicklung',
    'en/use-cases/lawyer',
    'en/use-cases/research',
    'en/use-cases/consulting',
    'en/use-cases/development',
  ]

  for (const route of routes) {
    it(`builds ${route} with self canonical + de/en/x-default hreflang`, () => {
      const file = resolve(root, 'dist', route, 'index.html')
      expect(existsSync(file), `missing dist/${route}/index.html`).toBe(true)
      const html = readFileSync(file, 'utf-8')
      expect(html, `${route} canonical`).toContain(
        `rel="canonical" href="https://loklm.com/${route}"`,
      )
      expect(html, `${route} hreflang de`).toMatch(/hreflang="de"/)
      expect(html, `${route} hreflang en`).toMatch(/hreflang="en"/)
      expect(html, `${route} hreflang x-default`).toMatch(/hreflang="x-default"/)
    })
  }
})

describe.skipIf(!distExists)('Phase 2 technical SEO', () => {
  it('robots.txt explicitly allows AI crawlers', () => {
    const robots = readFileSync(resolve(root, 'dist/robots.txt'), 'utf-8')
    for (const ua of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) {
      expect(robots, `robots.txt missing ${ua}`).toContain(`User-agent: ${ua}`)
    }
    expect(robots).toContain('Sitemap: https://loklm.com/sitemap-index.xml')
  })

  it('llms.txt is generated with pillar + persona links', () => {
    const llms = readFileSync(resolve(root, 'dist/llms.txt'), 'utf-8')
    expect(llms).toContain('# LokLM')
    expect(llms).toContain('https://loklm.com/lokale-ki')
    expect(llms).toContain('https://loklm.com/en/use-cases/lawyer')
  })

  it('pillar + persona pages embed WebPage and BreadcrumbList JSON-LD', () => {
    for (const r of ['lokale-ki', 'einsatz/anwalt', 'en/local-ai', 'en/use-cases/lawyer']) {
      const html = readFileSync(resolve(root, 'dist', r, 'index.html'), 'utf-8')
      expect(html, `${r} WebPage`).toContain('"@type":"WebPage"')
      expect(html, `${r} BreadcrumbList`).toContain('"@type":"BreadcrumbList"')
    }
  })

  it('persona pages embed FAQPage JSON-LD', () => {
    const html = readFileSync(resolve(root, 'dist/einsatz/anwalt/index.html'), 'utf-8')
    expect(html).toContain('"@type":"FAQPage"')
  })
})

describe.skipIf(!distExists)('Phase 3 blog', () => {
  it('blog index + post build in both locales', () => {
    for (const p of [
      'dist/blog/index.html',
      'dist/en/blog/index.html',
      'dist/blog/willkommen/index.html',
      'dist/en/blog/welcome/index.html',
    ]) {
      expect(existsSync(resolve(root, p)), `missing ${p}`).toBe(true)
    }
  })

  it('post embeds Article + BreadcrumbList JSON-LD and a translation hreflang', () => {
    const html = readFileSync(resolve(root, 'dist/blog/willkommen/index.html'), 'utf-8')
    expect(html).toContain('"@type":"Article"')
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toMatch(/hreflang="en" href="[^"]*\/en\/blog\/welcome"/)
  })

  it('RSS feeds and .md mirrors build', () => {
    for (const p of [
      'dist/blog/rss.xml',
      'dist/en/blog/rss.xml',
      'dist/blog/willkommen.md',
      'dist/en/blog/welcome.md',
    ]) {
      expect(existsSync(resolve(root, p)), `missing ${p}`).toBe(true)
    }
    expect(readFileSync(resolve(root, 'dist/blog/rss.xml'), 'utf-8')).toContain('<item>')
    expect(readFileSync(resolve(root, 'dist/blog/willkommen.md'), 'utf-8').startsWith('# ')).toBe(
      true,
    )
  })

  it('tag pages build in both locales', () => {
    expect(existsSync(resolve(root, 'dist/blog/tag/lokale-ki/index.html'))).toBe(true)
    expect(existsSync(resolve(root, 'dist/en/blog/tag/local-ai/index.html'))).toBe(true)
  })
})
