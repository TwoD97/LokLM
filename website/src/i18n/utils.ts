import { defaultLang, type Lang } from './ui'

export function getLangFromUrl(url: URL): Lang {
  const seg = url.pathname.split('/')[1]
  if (seg === 'en') return 'en'
  return defaultLang
}

export function localisedPath(lang: Lang, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  if (lang === defaultLang) return clean === '/' ? '/' : clean
  return `/${lang}${clean === '/' ? '' : clean}`
}
