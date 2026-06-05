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

export function resolveAlternates(siteUrl: string, paths?: AlternatePaths): Alternates {
  const base = siteUrl.replace(/\/$/, '')
  const dePath = paths?.de ?? '/'
  const enPath = paths?.en ?? '/en'
  const de = `${base}${dePath === '/' ? '' : dePath}`
  const en = `${base}${enPath}`
  return { de, en, xDefault: de }
}
