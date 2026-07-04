import { describe, it, expect } from 'vitest'
import {
  buildOrganizationSchema,
  buildSoftwareSchema,
  buildWebPageSchema,
  buildWebSiteSchema,
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildArticleSchema,
  buildBlogSchema,
} from './schema'

const siteUrl = 'https://loklm.com'
const siteName = 'LokLM'

describe('buildOrganizationSchema', () => {
  const schema = buildOrganizationSchema({ siteUrl, siteName })

  it('declares the schema.org Organization type', () => {
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Organization')
  })

  it('carries a stable @id anchored to siteUrl', () => {
    expect(schema['@id']).toBe(`${siteUrl}#organization`)
  })

  it('uses the supplied site name and url', () => {
    expect(schema.name).toBe(siteName)
    expect(schema.url).toBe(siteUrl)
  })

  it('logo points to the site-relative brand mark', () => {
    expect(schema.logo).toBe(`${siteUrl}/brand/mark-color.svg`)
  })

  it('sameAs links include the public GitHub repo', () => {
    expect(schema.sameAs).toContain('https://github.com/TwoD97/LokLM')
  })

  it('lists the founder as a Person node', () => {
    expect(schema.founder).toEqual([{ '@type': 'Person', name: 'Denys Tudosa' }])
  })

  it('round-trips through JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
  })
})

describe('buildSoftwareSchema', () => {
  const baseInput = {
    siteUrl,
    siteName,
    description: 'Local AI assistant.',
    softwareVersion: '0.2.3',
  }

  it('declares the schema.org SoftwareApplication type', () => {
    const s = buildSoftwareSchema(baseInput)
    expect(s['@context']).toBe('https://schema.org')
    expect(s['@type']).toBe('SoftwareApplication')
  })

  it('forwards name, version, description', () => {
    const s = buildSoftwareSchema(baseInput)
    expect(s.name).toBe(siteName)
    expect(s.softwareVersion).toBe('0.2.3')
    expect(s.description).toBe('Local AI assistant.')
  })

  it('image points to the OG asset', () => {
    const s = buildSoftwareSchema(baseInput)
    expect(s.image).toBe(`${siteUrl}/brand/og.png`)
  })

  it('advertises a free offer (price 0, EUR)', () => {
    const s = buildSoftwareSchema(baseInput)
    expect(s.isAccessibleForFree).toBe(true)
    expect(s.offers).toEqual({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    })
  })

  it('references the Organization @id as author', () => {
    const s = buildSoftwareSchema(baseInput)
    expect(s.author).toEqual({ '@id': `${siteUrl}#organization` })
  })

  it('declares both supported locales', () => {
    const s = buildSoftwareSchema(baseInput)
    expect(s.inLanguage).toEqual(['de', 'en'])
  })

  it('omits downloadUrl when winDownloadUrl is undefined', () => {
    const s = buildSoftwareSchema(baseInput)
    expect('downloadUrl' in s).toBe(false)
  })

  it('includes downloadUrl when winDownloadUrl is provided', () => {
    const s = buildSoftwareSchema({
      ...baseInput,
      winDownloadUrl: 'https://downloads.loklm.example/v0.2.3/LokLM-Setup-0.2.3-win-x64.exe',
    })
    expect(s.downloadUrl).toBe(
      'https://downloads.loklm.example/v0.2.3/LokLM-Setup-0.2.3-win-x64.exe',
    )
  })

  it('round-trips through JSON unchanged', () => {
    const s = buildSoftwareSchema({ ...baseInput, winDownloadUrl: 'https://x' })
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('buildWebPageSchema', () => {
  const s = buildWebPageSchema({
    url: 'https://loklm.com/lokale-ki',
    name: 'Lokale KI',
    description: 'desc',
    lang: 'de',
  })
  it('is a WebPage with id, url, inLanguage', () => {
    expect(s['@type']).toBe('WebPage')
    expect(s['@id']).toBe('https://loklm.com/lokale-ki#webpage')
    expect(s.url).toBe('https://loklm.com/lokale-ki')
    expect(s.name).toBe('Lokale KI')
    expect(s.inLanguage).toBe('de')
  })
})

describe('buildWebSiteSchema', () => {
  const s = buildWebSiteSchema({ siteUrl, siteName, description: 'Local AI assistant.' })
  it('is a WebSite anchored to a stable @id', () => {
    expect(s['@type']).toBe('WebSite')
    expect(s['@id']).toBe(`${siteUrl}#website`)
    expect(s.url).toBe(siteUrl)
    expect(s.name).toBe(siteName)
  })
  it('declares both locales and links the Organization as publisher', () => {
    expect(s.inLanguage).toEqual(['de', 'en'])
    expect(s.publisher).toEqual({ '@id': `${siteUrl}#organization` })
  })
})

describe('buildBlogSchema', () => {
  const s = buildBlogSchema({
    url: 'https://loklm.com/blog',
    name: 'Blog',
    description: 'desc',
    lang: 'de',
    posts: [
      {
        url: 'https://loklm.com/blog/a',
        headline: 'A',
        description: 'da',
        datePublished: '2026-05-01',
      },
    ],
  })
  it('is a Blog listing BlogPosting stubs', () => {
    expect(s['@type']).toBe('Blog')
    expect(s['@id']).toBe('https://loklm.com/blog#blog')
    expect(s.inLanguage).toBe('de')
    expect(s.blogPost).toHaveLength(1)
    expect(s.blogPost[0]).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'A',
      url: 'https://loklm.com/blog/a',
      datePublished: '2026-05-01',
    })
  })
})

describe('buildArticleSchema (enriched)', () => {
  const s = buildArticleSchema({
    url: 'https://loklm.com/blog/x',
    headline: 'X',
    description: 'd',
    lang: 'en',
    datePublished: '2026-01-01',
    siteUrl: 'https://loklm.com',
    image: 'https://loklm.com/brand/og.png',
    keywords: ['local-ai', 'privacy'],
  })
  it('links author/publisher to the Organization and carries image + keywords', () => {
    expect(s.author).toEqual({ '@id': 'https://loklm.com#organization' })
    expect((s.publisher as { '@id': string })['@id']).toBe('https://loklm.com#organization')
    expect(s.image).toBe('https://loklm.com/brand/og.png')
    expect(s.keywords).toBe('local-ai, privacy')
  })
})

describe('buildBreadcrumbSchema', () => {
  const s = buildBreadcrumbSchema([
    { name: 'Home', url: 'https://loklm.com' },
    { name: 'Lokale KI', url: 'https://loklm.com/lokale-ki' },
  ])
  it('numbers items in order', () => {
    expect(s['@type']).toBe('BreadcrumbList')
    expect(s.itemListElement).toHaveLength(2)
    expect(s.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://loklm.com',
    })
    expect(s.itemListElement[1].position).toBe(2)
  })
})

describe('buildFaqSchema', () => {
  const s = buildFaqSchema([{ question: 'Q1?', answer: 'A1.' }])
  it('wraps each QA as a Question/Answer pair', () => {
    expect(s['@type']).toBe('FAQPage')
    expect(s.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'Q1?',
      acceptedAnswer: { '@type': 'Answer', text: 'A1.' },
    })
  })
})

describe('buildArticleSchema', () => {
  const s = buildArticleSchema({
    url: 'https://loklm.com/blog/willkommen',
    headline: 'Willkommen',
    description: 'desc',
    lang: 'de',
    datePublished: '2026-05-01',
    dateModified: '2026-05-02',
  })
  it('is an Article with the SEO-relevant fields', () => {
    expect(s['@type']).toBe('Article')
    expect(s.headline).toBe('Willkommen')
    expect(s.inLanguage).toBe('de')
    expect(s.datePublished).toBe('2026-05-01')
    expect(s.dateModified).toBe('2026-05-02')
    expect(s.mainEntityOfPage).toBe('https://loklm.com/blog/willkommen')
    expect(s.author).toBeDefined()
  })
  it('falls back dateModified to datePublished when omitted', () => {
    const s2 = buildArticleSchema({
      url: 'u',
      headline: 'h',
      description: 'd',
      lang: 'en',
      datePublished: '2026-01-01',
    })
    expect(s2.dateModified).toBe('2026-01-01')
  })
})
