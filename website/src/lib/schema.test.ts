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

describe('Organization node', () => {
  const org = buildOrganizationSchema({ siteUrl, siteName })

  it('is typed as schema.org Organization', () => {
    expect(org['@context']).toBe('https://schema.org')
    expect(org['@type']).toBe('Organization')
  })

  it('anchors its @id fragment on the site url', () => {
    expect(org['@id']).toBe(`${siteUrl}#organization`)
  })

  it('takes name and url straight from the input', () => {
    expect(org.name).toBe(siteName)
    expect(org.url).toBe(siteUrl)
  })

  it('references the colored brand mark as logo', () => {
    expect(org.logo).toBe(`${siteUrl}/brand/mark-color.svg`)
  })

  it('counts the GitHub repository among sameAs links', () => {
    expect(org.sameAs).toContain('https://github.com/TwoD97/LokLM')
  })

  it('names the founder as a Person entry', () => {
    expect(org.founder).toEqual([{ '@type': 'Person', name: 'Denys Tudosa' }])
  })

  it('survives a JSON stringify/parse round trip intact', () => {
    expect(JSON.parse(JSON.stringify(org))).toEqual(org)
  })
})

describe('SoftwareApplication node', () => {
  const input = {
    siteUrl,
    siteName,
    description: 'Local AI assistant.',
    softwareVersion: '0.2.3',
  }

  it('is typed as schema.org SoftwareApplication', () => {
    const node = buildSoftwareSchema(input)
    expect(node['@context']).toBe('https://schema.org')
    expect(node['@type']).toBe('SoftwareApplication')
  })

  it('passes name, softwareVersion and description through', () => {
    const node = buildSoftwareSchema(input)
    expect(node.name).toBe(siteName)
    expect(node.softwareVersion).toBe('0.2.3')
    expect(node.description).toBe('Local AI assistant.')
  })

  it('uses the OG image as its image', () => {
    const node = buildSoftwareSchema(input)
    expect(node.image).toBe(`${siteUrl}/brand/og.png`)
  })

  it('markets the app as free: accessible for free plus a 0-EUR offer', () => {
    const node = buildSoftwareSchema(input)
    expect(node.isAccessibleForFree).toBe(true)
    expect(node.offers).toEqual({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    })
  })

  it('points author at the Organization by @id reference', () => {
    const node = buildSoftwareSchema(input)
    expect(node.author).toEqual({ '@id': `${siteUrl}#organization` })
  })

  it('lists de and en as its languages', () => {
    const node = buildSoftwareSchema(input)
    expect(node.inLanguage).toEqual(['de', 'en'])
  })

  it('leaves downloadUrl out entirely when no windows url is given', () => {
    const node = buildSoftwareSchema(input)
    expect('downloadUrl' in node).toBe(false)
  })

  it('sets downloadUrl once a windows installer url is supplied', () => {
    const winDownloadUrl = 'https://downloads.loklm.example/v0.2.3/LokLM-Setup-0.2.3-win-x64.exe'
    const node = buildSoftwareSchema({ ...input, winDownloadUrl })
    expect(node.downloadUrl).toBe(winDownloadUrl)
  })

  it('survives a JSON stringify/parse round trip intact', () => {
    const node = buildSoftwareSchema({ ...input, winDownloadUrl: 'https://x' })
    expect(JSON.parse(JSON.stringify(node))).toEqual(node)
  })
})

describe('WebPage node', () => {
  const node = buildWebPageSchema({
    url: 'https://loklm.com/lokale-ki',
    name: 'Lokale KI',
    description: 'desc',
    lang: 'de',
  })

  it('carries type, #webpage id, url, name and language', () => {
    expect(node['@type']).toBe('WebPage')
    expect(node['@id']).toBe('https://loklm.com/lokale-ki#webpage')
    expect(node.url).toBe('https://loklm.com/lokale-ki')
    expect(node.name).toBe('Lokale KI')
    expect(node.inLanguage).toBe('de')
  })
})

describe('WebSite node', () => {
  const node = buildWebSiteSchema({ siteUrl, siteName, description: 'Local AI assistant.' })

  it('is a WebSite with a stable #website id, site url and name', () => {
    expect(node['@type']).toBe('WebSite')
    expect(node['@id']).toBe(`${siteUrl}#website`)
    expect(node.url).toBe(siteUrl)
    expect(node.name).toBe(siteName)
  })

  it('covers both locales and cites the Organization as publisher', () => {
    expect(node.inLanguage).toEqual(['de', 'en'])
    expect(node.publisher).toEqual({ '@id': `${siteUrl}#organization` })
  })
})

describe('Blog node', () => {
  const node = buildBlogSchema({
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

  it('is a Blog whose blogPost array holds BlogPosting stubs', () => {
    expect(node['@type']).toBe('Blog')
    expect(node['@id']).toBe('https://loklm.com/blog#blog')
    expect(node.inLanguage).toBe('de')
    expect(node.blogPost).toHaveLength(1)
    expect(node.blogPost[0]).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'A',
      url: 'https://loklm.com/blog/a',
      datePublished: '2026-05-01',
    })
  })
})

describe('Article node — with image and keywords', () => {
  const node = buildArticleSchema({
    url: 'https://loklm.com/blog/x',
    headline: 'X',
    description: 'd',
    lang: 'en',
    datePublished: '2026-01-01',
    siteUrl: 'https://loklm.com',
    image: 'https://loklm.com/brand/og.png',
    keywords: ['local-ai', 'privacy'],
  })

  it('wires author and publisher to the Organization, joins keywords, keeps the image', () => {
    expect(node.author).toEqual({ '@id': 'https://loklm.com#organization' })
    expect((node.publisher as { '@id': string })['@id']).toBe('https://loklm.com#organization')
    expect(node.image).toBe('https://loklm.com/brand/og.png')
    expect(node.keywords).toBe('local-ai, privacy')
  })
})

describe('BreadcrumbList node', () => {
  const node = buildBreadcrumbSchema([
    { name: 'Home', url: 'https://loklm.com' },
    { name: 'Lokale KI', url: 'https://loklm.com/lokale-ki' },
  ])

  it('assigns 1-based positions in input order', () => {
    expect(node['@type']).toBe('BreadcrumbList')
    expect(node.itemListElement).toHaveLength(2)
    expect(node.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://loklm.com',
    })
    expect(node.itemListElement[1].position).toBe(2)
  })
})

describe('FAQPage node', () => {
  const node = buildFaqSchema([{ question: 'Q1?', answer: 'A1.' }])

  it('turns every entry into a Question with an acceptedAnswer', () => {
    expect(node['@type']).toBe('FAQPage')
    expect(node.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'Q1?',
      acceptedAnswer: { '@type': 'Answer', text: 'A1.' },
    })
  })
})

describe('Article node — base fields', () => {
  const node = buildArticleSchema({
    url: 'https://loklm.com/blog/willkommen',
    headline: 'Willkommen',
    description: 'desc',
    lang: 'de',
    datePublished: '2026-05-01',
    dateModified: '2026-05-02',
  })

  it('exposes the fields search engines care about', () => {
    expect(node['@type']).toBe('Article')
    expect(node.headline).toBe('Willkommen')
    expect(node.inLanguage).toBe('de')
    expect(node.datePublished).toBe('2026-05-01')
    expect(node.dateModified).toBe('2026-05-02')
    expect(node.mainEntityOfPage).toBe('https://loklm.com/blog/willkommen')
    expect(node.author).toBeDefined()
  })

  it('copies datePublished into dateModified when the latter is missing', () => {
    const minimal = buildArticleSchema({
      url: 'u',
      headline: 'h',
      description: 'd',
      lang: 'en',
      datePublished: '2026-01-01',
    })
    expect(minimal.dateModified).toBe('2026-01-01')
  })
})
