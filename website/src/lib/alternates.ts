// Resolves hreflang alternates for a page. x-default points at the DE (default-locale) URL.
export interface AlternatePaths {
  de: string // e.g. '/lokale-ki'
  en: string // e.g. '/en/local-ai'
}

export interface Alternates {
  de: string
  en: string
  xDefault: string
}

// Only these static pages have an implicit translation pair. Content routes
// supply their published pair explicitly; missing translations stay missing.
const staticPairs: AlternatePaths[] = [
  { de: '/', en: '/en' },
  { de: '/imprint', en: '/en/imprint' },
  { de: '/privacy', en: '/en/privacy' },
]

export function resolveAlternates(
  siteUrl: string,
  pathname: string,
  paths?: AlternatePaths,
): Alternates | undefined {
  const page = pathname.replace(/\/$/, '') || '/'
  const pair =
    paths ?? staticPairs.find((candidate) => candidate.de === page || candidate.en === page)
  if (!pair) return undefined
  const base = siteUrl.replace(/\/$/, '')
  const dePath = pair.de
  const enPath = pair.en
  const de = `${base}${dePath === '/' ? '' : dePath}`
  const en = `${base}${enPath}`
  return { de, en, xDefault: de }
}
