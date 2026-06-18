// schema.org JSON-LD builders.
// kept as pure builders so the layout has no untestable inline logic and
// regressions on SEO-relevant fields are caught by unit tests.

export interface OrganizationSchemaInput {
  siteUrl: string
  siteName: string
}

export interface SoftwareSchemaInput {
  siteUrl: string
  siteName: string
  description: string
  softwareVersion: string
  winDownloadUrl?: string
}

export function buildOrganizationSchema(input: OrganizationSchemaInput) {
  const { siteUrl, siteName } = input
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}#organization`,
    name: siteName,
    url: siteUrl,
    logo: `${siteUrl}/brand/mark-color.svg`,
    sameAs: ['https://github.com/TwoD97/LokLM'],
    founder: [
      { '@type': 'Person', name: 'Denys Tudosa' },
      { '@type': 'Person', name: 'Dominik Furlan' },
    ],
  } as const
}

export function buildSoftwareSchema(input: SoftwareSchemaInput) {
  const { siteUrl, siteName, description, softwareVersion, winDownloadUrl } = input
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: siteName,
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Windows 10, Windows 11',
    url: siteUrl,
    image: `${siteUrl}/brand/og.png`,
    description,
    softwareVersion,
    inLanguage: ['de', 'en'],
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    },
    author: { '@id': `${siteUrl}#organization` },
    ...(winDownloadUrl ? { downloadUrl: winDownloadUrl } : {}),
  }
}

export interface WebPageSchemaInput {
  url: string
  name: string
  description: string
  lang: 'de' | 'en'
}

export function buildWebPageSchema(input: WebPageSchemaInput) {
  const { url, name, description, lang } = input
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: lang,
  }
}

export interface WebSiteSchemaInput {
  siteUrl: string
  siteName: string
  description: string
}

// WebSite node ties the whole graph together (publisher -> Organization @id)
// and is what search engines look for to attach the site name / sitelinks.
export function buildWebSiteSchema(input: WebSiteSchemaInput) {
  const { siteUrl, siteName, description } = input
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}#website`,
    url: siteUrl,
    name: siteName,
    description,
    inLanguage: ['de', 'en'],
    publisher: { '@id': `${siteUrl}#organization` },
  }
}

export interface BreadcrumbItem {
  name: string
  url: string
}

export function buildBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  }
}

export interface ArticleSchemaInput {
  url: string
  headline: string
  description: string
  lang: 'de' | 'en'
  datePublished: string
  dateModified?: string
  /** site origin, e.g. https://loklm.com — enables a logo'd publisher + org-linked author */
  siteUrl?: string
  /** social/preview image absolute url */
  image?: string
  /** topical keywords (typically the post tags) */
  keywords?: string[]
}

export function buildArticleSchema(input: ArticleSchemaInput) {
  const { url, headline, description, lang, datePublished, dateModified, siteUrl, image, keywords } =
    input

  const publisher = siteUrl
    ? {
        '@type': 'Organization',
        '@id': `${siteUrl}#organization`,
        name: 'LokLM',
        logo: { '@type': 'ImageObject', url: `${siteUrl}/brand/mark-color.svg` },
      }
    : { '@type': 'Organization', name: 'LokLM' }

  const author = siteUrl ? { '@id': `${siteUrl}#organization` } : { '@type': 'Organization', name: 'LokLM' }

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    inLanguage: lang,
    datePublished,
    dateModified: dateModified ?? datePublished,
    mainEntityOfPage: url,
    author,
    publisher,
    ...(image ? { image } : {}),
    ...(keywords && keywords.length ? { keywords: keywords.join(', ') } : {}),
  }
}

export interface BlogPostRef {
  url: string
  headline: string
  description: string
  datePublished: string
}

export interface BlogSchemaInput {
  url: string
  name: string
  description: string
  lang: 'de' | 'en'
  posts: BlogPostRef[]
}

// Blog collection page: a Blog node listing its posts as BlogPosting stubs.
// Gives search engines an explicit feed of the article URLs from the index.
export function buildBlogSchema(input: BlogSchemaInput) {
  const { url, name, description, lang, posts } = input
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${url}#blog`,
    url,
    name,
    description,
    inLanguage: lang,
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.headline,
      description: p.description,
      url: p.url,
      datePublished: p.datePublished,
    })),
  }
}

export interface FaqEntry {
  question: string
  answer: string
}

export function buildFaqSchema(entries: FaqEntry[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer },
    })),
  }
}
