import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dist = resolve(__dirname, '../dist')
const origin = 'https://loklm.com'
const hasBuild = existsSync(dist)

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : []
  })
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

function alternates(html: string): Record<string, string> {
  return Object.fromEntries(
    [...html.matchAll(/<link\b[^>]*>/g)].flatMap(([tag]) => {
      const lang = attribute(tag, 'hreflang')
      const href = attribute(tag, 'href')
      return attribute(tag, 'rel') === 'alternate' && lang && href
        ? [[lang, new URL(href).href]]
        : []
    }),
  )
}

const pages = hasBuild
  ? htmlFiles(dist).map((file) => {
      const html = readFileSync(file, 'utf8')
      const route = `/${relative(dist, file)
        .replaceAll('\\', '/')
        .replace(/(?:^|\/)index\.html$/, '')}`
      const canonicalTag = [...html.matchAll(/<link\b[^>]*>/g)].find(
        ([tag]) => attribute(tag, 'rel') === 'canonical',
      )?.[0]
      const canonical = canonicalTag && attribute(canonicalTag, 'href')
      const robotsTag = [...html.matchAll(/<meta\b[^>]*>/g)].find(
        ([tag]) => attribute(tag, 'name') === 'robots',
      )?.[0]
      return {
        route,
        html,
        canonical,
        url: new URL(route, origin).href,
        lang: html.match(/<html\b[^>]*\blang="([^"]*)"/)?.[1],
        noindex: /\bnoindex\b/.test(robotsTag ? (attribute(robotsTag, 'content') ?? '') : ''),
        alternates: alternates(html),
      }
    })
  : []
const byUrl = new Map(pages.map((page) => [page.url, page]))

// Inspect a fresh static build in CI, including newly authored content and
// translated slugs. No fixed route count or duplicated translation table.
describe.skipIf(!hasBuild)('built SEO consistency', () => {
  it('every HTML route has exactly one self-canonical URL and the matching language', () => {
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      const canonicalTags = [...page.html.matchAll(/<link\b[^>]*>/g)].filter(
        ([tag]) => attribute(tag, 'rel') === 'canonical',
      )
      expect(canonicalTags, page.route).toHaveLength(1)
      expect(page.canonical, page.route).toBeDefined()
      expect(new URL(page.canonical!).href, page.route).toBe(page.url)
      expect(page.lang, page.route).toBe(
        page.route === '/en' || page.route.startsWith('/en/') ? 'en' : 'de',
      )
    }
  })

  it('hreflang groups include themselves and reciprocal, published canonical equivalents', () => {
    for (const page of pages) {
      if (page.noindex) {
        expect(page.alternates, page.route).toEqual({})
        continue
      }
      if (Object.keys(page.alternates).length === 0) continue
      expect(page.alternates[page.lang!], page.route).toBe(page.url)
      expect(page.alternates['x-default'], page.route).toBe(page.alternates.de)
      for (const [lang, href] of Object.entries(page.alternates)) {
        const target = byUrl.get(href)
        expect(target, `${page.route}: ${lang} -> ${href}`).toBeDefined()
        expect(target!.noindex, href).toBe(false)
        expect(new URL(target!.canonical!).href, href).toBe(href)
        if (lang !== 'x-default') expect(target!.lang, href).toBe(lang)
        expect(target!.alternates, `${page.route} -> ${href}: reciprocal group`).toEqual(
          page.alternates,
        )
      }
    }
  })

  it('the sitemap contains precisely indexable HTML canonicals, without feeds, mirrors or tag views', () => {
    const index = readFileSync(join(dist, 'sitemap-index.xml'), 'utf8')
    const sitemapUrls = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]),
    )
    expect(sitemapUrls.length).toBeGreaterThan(0)
    const urls = sitemapUrls.flatMap((url) => {
      expect(url.origin).toBe(origin)
      const xml = readFileSync(join(dist, url.pathname), 'utf8')
      return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).href)
    })
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls.sort()).toEqual(
      pages
        .filter((page) => !page.noindex)
        .map((page) => page.url)
        .sort(),
    )
  })

  it('RSS items link directly to canonical, indexable pages in the feed language', () => {
    for (const lang of ['de', 'en']) {
      const xml = readFileSync(
        join(dist, lang === 'de' ? 'blog/rss.xml' : 'en/blog/rss.xml'),
        'utf8',
      )
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      expect(items.length, lang).toBeGreaterThan(0)
      for (const [, item] of items) {
        const link = item.match(/<link>([^<]+)<\/link>/)?.[1]
        expect(link, lang).toBeDefined()
        const target = byUrl.get(link!)
        expect(target, link).toBeDefined()
        expect(target!.canonical, link).toBe(link)
        expect(target!.noindex, link).toBe(false)
        expect(target!.lang, link).toBe(lang)
      }
    }
  })

  it('same-origin links resolve to generated pages or assets, with existing HTML fragments', () => {
    for (const page of pages) {
      for (const [tag] of page.html.matchAll(/<a\b[^>]*>/g)) {
        const href = attribute(tag, 'href')?.replaceAll('&amp;', '&')
        if (href === undefined) continue
        const url = new URL(href, page.url)
        if (url.origin !== origin) continue
        const targetPath = url.pathname.replace(/\/$/, '') || '/'
        const target = byUrl.get(new URL(targetPath, origin).href)
        const label = `${page.route}: ${href}`
        if (!target) {
          const asset = join(dist, decodeURIComponent(url.pathname))
          expect(existsSync(asset) && statSync(asset).isFile(), label).toBe(true)
          continue
        }
        if (!url.hash) continue
        const fragment = decodeURIComponent(url.hash.slice(1))
        // Text-fragment directives do not require an element ID.
        const elementId = fragment.split(':~:text=')[0]
        if (!elementId) continue
        const targets = [...target.html.matchAll(/<[^>]+>/g)].flatMap(([element]) => {
          const id = attribute(element, 'id')
          const name = /^<a\b/.test(element) ? attribute(element, 'name') : undefined
          return [id, name].filter((value) => value !== undefined)
        })
        expect(targets, label).toContain(elementId)
      }
    }
  })

  it('JSON-LD parses and app/site descriptions are restricted to homepages', () => {
    for (const page of pages) {
      const scripts = [
        ...page.html.matchAll(
          /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
        ),
      ]
      const nodes = scripts.map(([, json]) => JSON.parse(json) as { '@type': string })
      const types = nodes.map((node) => node['@type'])
      expect(types, page.route).toContain('Organization')
      for (const type of ['WebSite', 'SoftwareApplication']) {
        expect(types.includes(type), `${page.route}: ${type}`).toBe(
          page.route === '/' || page.route === '/en',
        )
      }
      if (types.includes('Article')) {
        expect(types, page.route).toContain('BreadcrumbList')
        expect(page.noindex, page.route).toBe(false)
      }
    }
  })
})
