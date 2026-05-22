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
