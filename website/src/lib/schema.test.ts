import { describe, it, expect } from 'vitest'
import {
  buildOrganizationSchema,
  buildSoftwareSchema,
  buildWebPageSchema,
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildArticleSchema,
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

  it('lists both founders as Person nodes', () => {
    expect(schema.founder).toEqual([
      { '@type': 'Person', name: 'Denys Tudosa' },
      { '@type': 'Person', name: 'Dominik Furlan' },
    ])
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
