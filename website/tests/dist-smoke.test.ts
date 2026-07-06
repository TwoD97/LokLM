import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const inDist = (rel: string) => resolve(root, 'dist', rel)
const readDist = (rel: string) => readFileSync(inDist(rel), 'utf-8')

// These suites inspect the static build. Without a prior `pnpm build` there
// is no dist/, so they skip instead of failing — `pnpm ci` (build + test)
// exercises them for real.
const hasBuild = existsSync(resolve(root, 'dist'))

describe.skipIf(!hasBuild)('core pages', () => {
  const corePages = [
    'index.html',
    'imprint/index.html',
    'privacy/index.html',
    'en/index.html',
    'en/imprint/index.html',
    'en/privacy/index.html',
  ]

  for (const page of corePages) {
    it(`dist/${page} is written`, () => {
      expect(existsSync(inDist(page))).toBe(true)
    })
  }

  it('each core page carries a <title>', () => {
    for (const page of corePages) {
      expect(readDist(page), page).toMatch(/<title>.*<\/title>/i)
    }
  })

  it('each core page carries a canonical link', () => {
    for (const page of corePages) {
      expect(readDist(page), page).toMatch(/<link\s+rel="canonical"/i)
    }
  })

  it('each core page inlines the Organization and SoftwareApplication JSON-LD', () => {
    for (const page of corePages) {
      const html = readDist(page)
      expect(html, `${page} missing Organization`).toContain('"@type":"Organization"')
      expect(html, `${page} missing SoftwareApplication`).toContain(
        '"@type":"SoftwareApplication"',
      )
    }
  })

  it('the html element carries the matching lang attribute per locale', () => {
    expect(readDist('index.html')).toMatch(/<html\s+lang="de"/i)
    expect(readDist('en/index.html')).toMatch(/<html\s+lang="en"/i)
  })
})

describe.skipIf(!hasBuild)('sitemap output', () => {
  it('writes sitemap-index.xml that references a numbered sub-sitemap', () => {
    expect(existsSync(inDist('sitemap-index.xml'))).toBe(true)
    const body = readDist('sitemap-index.xml')
    expect(body).toContain('<sitemapindex')
    expect(body).toMatch(/<loc>https:\/\/loklm\.com\/sitemap-\d+\.xml<\/loc>/)
  })

  it('sub-sitemap covers all six core urls and declares hreflang alternates', () => {
    expect(existsSync(inDist('sitemap-0.xml'))).toBe(true)
    const body = readDist('sitemap-0.xml')

    const expectedUrls = [
      'https://loklm.com',
      'https://loklm.com/imprint',
      'https://loklm.com/privacy',
      'https://loklm.com/en',
      'https://loklm.com/en/imprint',
      'https://loklm.com/en/privacy',
    ]
    for (const url of expectedUrls) {
      expect(body, `missing <loc>${url}</loc>`).toContain(`<loc>${url}</loc>`)
    }

    expect(body).toContain('hreflang="de-DE"')
    expect(body).toContain('hreflang="en-US"')
  })
})

describe.skipIf(!hasBuild)('cluster routes', () => {
  const clusterRoutes = [
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

  for (const route of clusterRoutes) {
    it(`${route}: self-canonical plus de/en/x-default hreflang`, () => {
      const file = inDist(`${route}/index.html`)
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

describe.skipIf(!hasBuild)('AI-crawler / structured-data extras (phase 2)', () => {
  it('robots.txt opts the big AI crawlers in and names the sitemap', () => {
    const robots = readDist('robots.txt')
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) {
      expect(robots, `robots.txt missing ${bot}`).toContain(`User-agent: ${bot}`)
    }
    expect(robots).toContain('Sitemap: https://loklm.com/sitemap-index.xml')
  })

  it('llms.txt exists with pillar/persona links, key facts and FAQ', () => {
    const llms = readDist('llms.txt')
    expect(llms).toContain('# LokLM')
    expect(llms).toContain('https://loklm.com/lokale-ki')
    expect(llms).toContain('https://loklm.com/en/use-cases/lawyer')
    expect(llms).toContain('## Key facts')
    expect(llms).toContain('## FAQ')
    expect(llms).toContain('/llms-full.txt')
  })

  it('llms-full.txt contains actual post bodies', () => {
    const full = readDist('llms-full.txt')
    expect(full.startsWith('# LokLM — full content')).toBe(true)
    // this phrase only occurs inside a post body, never in frontmatter
    // (sentinel tracks the current wording of the taxonomy article)
    expect(full).toContain('three separable steps')
  })

  it('the home page inlines the WebSite JSON-LD node', () => {
    const html = readDist('index.html')
    expect(html).toContain('"@type":"WebSite"')
    expect(html).toContain('#website')
  })

  it('pillar and persona pages inline WebPage plus BreadcrumbList JSON-LD', () => {
    for (const route of ['lokale-ki', 'einsatz/anwalt', 'en/local-ai', 'en/use-cases/lawyer']) {
      const html = readDist(`${route}/index.html`)
      expect(html, `${route} WebPage`).toContain('"@type":"WebPage"')
      expect(html, `${route} BreadcrumbList`).toContain('"@type":"BreadcrumbList"')
    }
  })

  it('persona pages inline FAQPage JSON-LD', () => {
    expect(readDist('einsatz/anwalt/index.html')).toContain('"@type":"FAQPage"')
  })
})

describe.skipIf(!hasBuild)('blog output (phase 3)', () => {
  // one real translation pair that must exist in the content collection
  const deSlug = 'taxonomie-lokaler-ki'
  const enSlug = 'taxonomy-of-local-ai'

  it('index and post pages exist for both locales', () => {
    for (const page of [
      'blog/index.html',
      'en/blog/index.html',
      `blog/${deSlug}/index.html`,
      `en/blog/${enSlug}/index.html`,
    ]) {
      expect(existsSync(inDist(page)), `missing dist/${page}`).toBe(true)
    }
  })

  it('the blog index carries Blog + BreadcrumbList JSON-LD and advertises RSS', () => {
    const html = readDist('blog/index.html')
    expect(html).toContain('"@type":"Blog"')
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toMatch(/rel="alternate"\s+type="application\/rss\+xml"/)
  })

  it('a post carries Article + BreadcrumbList JSON-LD and links its translation', () => {
    const html = readDist(`blog/${deSlug}/index.html`)
    expect(html).toContain('"@type":"Article"')
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toMatch(new RegExp(`hreflang="en" href="[^"]*\\/en\\/blog\\/${enSlug}"`))
  })

  it('a post uses og:type article and article: meta tags', () => {
    const html = readDist(`blog/${deSlug}/index.html`)
    expect(html).toMatch(/property="og:type"\s+content="article"/)
    expect(html).toMatch(/property="article:published_time"/)
  })

  it('RSS feeds and markdown mirrors are written and non-trivial', () => {
    for (const page of [
      'blog/rss.xml',
      'en/blog/rss.xml',
      `blog/${deSlug}.md`,
      `en/blog/${enSlug}.md`,
    ]) {
      expect(existsSync(inDist(page)), `missing dist/${page}`).toBe(true)
    }
    expect(readDist('blog/rss.xml')).toContain('<item>')
    expect(readDist(`blog/${deSlug}.md`).startsWith('# ')).toBe(true)
  })

  it('tag pages exist per locale and are marked noindex', () => {
    const deTag = inDist('blog/tag/lokale-ki/index.html')
    const enTag = inDist('en/blog/tag/local-ai/index.html')
    expect(existsSync(deTag)).toBe(true)
    expect(existsSync(enTag)).toBe(true)
    expect(readFileSync(deTag, 'utf-8')).toMatch(/name="robots"\s+content="noindex/)
  })

  it('the home page inlines FAQPage JSON-LD', () => {
    expect(readDist('index.html')).toContain('"@type":"FAQPage"')
  })
})
